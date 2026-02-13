import fs from 'fs'
import path from 'path'
import { ConfigManager } from '../config-manager'
import { ApiConfig, ChatMessage, InvokeContext, TaskType, ToolDefinition, ToolParameter, ToolResult } from '../../common/types'
import { MemoryManager } from './memory-manager'

interface ChatCompletionMessage {
  role: string
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

interface ChatCompletionRequest {
  model: string
  messages: ChatCompletionMessage[]
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description: string
      parameters: Record<string, unknown>
    }
  }>
  [key: string]: unknown
}

interface ChatCompletionResponse {
  choices: Array<{
    message: ChatCompletionMessage
    finish_reason: string
  }>
  meta?: {
    model: string
    taskType: TaskType
  }
}

type PreparedContext = {
  taskType: TaskType
  messages: ChatMessage[]
}

interface WorkChainStep {
  taskType: TaskType
  instruction: string
  intent?: string
  useTools?: boolean
}

interface WorkChainPlan {
  steps: WorkChainStep[]
  finalInstruction: string
}

type StepExecutionResult = {
  taskType: TaskType
  modelName: string
  instruction: string
  content: string
  toolOutputs: Array<{ name: string; content: string; isError?: boolean }>
}

type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<ToolResult>
type WorkflowLogEmitter = (level: 'info' | 'warn' | 'error', message: string, source?: string) => void

export function estimateTokens(messages: ChatMessage[]): number {
  const chars = messages.reduce((sum, m) => sum + m.content.length, 0)
  return Math.ceil(chars / 4)
}

function getLastUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return messages[i]
  }
  return undefined
}

export function shouldCompressContext(messages: ChatMessage[], thresholdTokens: number): boolean {
  return estimateTokens(messages) > thresholdTokens
}

function nonSystemTurnCount(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role !== 'system').length
}

export function injectMemorySystemPrompt(messages: ChatMessage[], memories: Array<{ text: string }>): ChatMessage[] {
  if (!memories.length) return messages
  const memoryPrompt = memories.map((item, index) => `${index + 1}. ${item.text}`).join('\n')
  return [
    {
      id: `memory-${Date.now()}`,
      role: 'system',
      content: `以下是与用户相关的长期记忆，请在回答时优先遵循：\n${memoryPrompt}`,
      timestamp: Date.now(),
    },
    ...messages,
  ]
}

function pickMemoryCandidates(text: string): string[] {
  const lines = text.split(/[\n。！？!?]/).map((line) => line.trim())
  return lines.filter((line) =>
    /(记住|我喜欢|我不喜欢|我习惯|我是|我叫|我的偏好|请记下|偏好)/.test(line)
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const PREMIER_DISPATCH_PROMPT = `你是任务编排器（总理模型），负责把一次请求拆分成可执行工作流。

你会收到：
1) 用户最新输入
2) 最近上下文摘要
3) 触发原因
4) 可用工具列表
5) 记忆摘要
6) 可操作文件清单

可用任务类型：
- roleplay: 角色扮演对话
- context_compression: 上下文压缩
- memory_fragmentation: 记忆碎片化/知识归并
- vision: 图像理解
- code_generation: 代码生成与改写
- premier: 总理模型直接处理

请仅返回 JSON，结构如下：
{
  "steps": [
    {
      "taskType": "roleplay|context_compression|memory_fragmentation|vision|code_generation|premier",
      "instruction": "给该步骤模型的具体执行指令，必须可直接执行",
      "intent": "该步骤要达成的目标",
      "useTools": true
    }
  ],
  "finalInstruction": "最终回复阶段的风格与约束"
}

规则：
1) steps 按执行顺序排列；
2) 若无需拆分，可仅返回一步 premier；
3) 除确有必要，不要生成过多步骤（建议 1~3 步）；
4) instruction 中不得直接伪造工具结果，工具结果必须由工具执行产生。`

export class AIEngine {
  private configManager: ConfigManager
  private memoryManager: MemoryManager
  private abortController: AbortController | null = null
  private toolExecutor?: ToolExecutor
  private workflowLogger?: WorkflowLogEmitter

  constructor(configManager: ConfigManager, toolExecutor?: ToolExecutor, workflowLogger?: WorkflowLogEmitter) {
    this.configManager = configManager
    this.memoryManager = new MemoryManager()
    this.toolExecutor = toolExecutor
    this.workflowLogger = workflowLogger
  }

  async chat(
    messages: ChatMessage[],
    apiConfigId?: string,
    model?: string,
    taskType: TaskType = 'premier',
    tools?: ToolDefinition[],
    invokeContext?: InvokeContext
  ): Promise<ChatCompletionResponse> {
    const prepared = await this.prepareContext(messages, taskType)
    const safeTools = Array.isArray(tools) ? tools : []
    this.logWorkflow(
      '请求上下文',
      [
        `taskType=${taskType}`,
        `invokeContext=${invokeContext ? JSON.stringify(invokeContext) : 'text_input'}`,
        `tools=\n${this.serializeTools(safeTools) || 'none'}`,
        `原始消息:\n${this.serializeMessages(messages) || 'none'}`,
        `预处理后消息:\n${this.serializeMessages(prepared.messages) || 'none'}`,
      ].join('\n\n')
    )
    const plan = await this.dispatchViaPremier(prepared.messages, safeTools, invokeContext)
    const stepResults = await this.executeWorkChain(plan.steps, prepared.messages, apiConfigId, model, safeTools)
    const finalResponse = await this.buildFinalResponse(
      plan,
      prepared.messages,
      stepResults,
      apiConfigId,
      model
    )

    const assistantContent = finalResponse.choices?.[0]?.message?.content || ''
    this.rememberIfNeeded(prepared.messages, assistantContent)
    return finalResponse
  }

  private logWorkflow(title: string, content: string, level: 'info' | 'warn' | 'error' = 'info') {
    if (!this.workflowLogger) return
    this.workflowLogger(level, `[工作流] ${title}\n${content}`, 'chat-workflow')
  }

  private serializeMessages(messages: ChatMessage[]): string {
    return messages
      .map((item, idx) => {
        const toolCalls = Array.isArray(item.toolCalls)
          ? item.toolCalls
              .map((tc, tcIndex) => {
                return `  toolCall#${tcIndex + 1}: ${tc.name} args=${JSON.stringify(tc.arguments || {})}`
              })
              .join('\n')
          : ''
        const toolCallId = item.toolCallId ? `\n  toolCallId=${item.toolCallId}` : ''
        return `[${idx + 1}] role=${item.role}${toolCallId}\n${item.content || ''}${toolCalls ? `\n${toolCalls}` : ''}`
      })
      .join('\n\n')
  }

  private stringifyToolParameter(param: ToolParameter, required: boolean): string {
    const enumPart = Array.isArray(param.enum) && param.enum.length > 0 ? `, enum=${param.enum.join(' | ')}` : ''
    const childProperties =
      param.properties && Object.keys(param.properties).length > 0
        ? `, properties={${Object.entries(param.properties)
            .map(([key, value]) => `${key}:${value.type}`)
            .join(', ')}}`
        : ''
    const itemsPart = param.items ? `, items=${param.items.type}` : ''
    return `${required ? 'required' : 'optional'} ${param.type}: ${param.description}${enumPart}${itemsPart}${childProperties}`
  }

  private serializeTools(tools: ToolDefinition[]): string {
    return tools
      .map((tool) => {
        const required = new Set(tool.required || [])
        const params = Object.entries(tool.parameters || {})
          .map(([name, param]) => `${name}(${this.stringifyToolParameter(param, required.has(name))})`)
          .join(' ; ')
        return `- ${tool.name}: ${tool.description} | 参数详情: ${params || '无参数'}`
      })
      .join('\n')
  }

  private async dispatchViaPremier(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    invokeContext?: InvokeContext
  ): Promise<WorkChainPlan> {
    const { apiConfig, modelName } = this.resolveModelRoute('premier')
    const latestUserText = getLastUserMessage(messages)?.content || ''
    if (!latestUserText.trim()) {
      return {
        steps: [{ taskType: 'premier', instruction: '直接回答用户问题。', intent: '直接回复', useTools: false }],
        finalInstruction: '输出简洁、准确、可执行的最终答复。',
      }
    }
    if (!apiConfig || !modelName) {
      return {
        steps: [{ taskType: 'premier', instruction: '直接回答用户问题。', intent: '直接回复', useTools: false }],
        finalInstruction: '输出简洁、准确、可执行的最终答复。',
      }
    }

    const plannerInput = await this.buildPlannerInput(messages, tools, invokeContext)
    this.logWorkflow(
      '总理模型规划请求',
      [
        `model=${modelName}`,
        `plannerInput:\n${plannerInput}`,
      ].join('\n\n')
    )
    try {
      const response = await this.requestChatCompletion(apiConfig, {
        model: modelName,
        messages: [
          { role: 'system', content: PREMIER_DISPATCH_PROMPT },
          { role: 'user', content: plannerInput },
        ],
      })
      const raw = response.choices?.[0]?.message?.content || ''
      const parsed = this.parseWorkChainPlan(raw)
      this.logWorkflow(
        '总理模型规划结果',
        [
          `raw:\n${raw || '空'}`,
          `parsed:\n${JSON.stringify(parsed, null, 2)}`,
        ].join('\n\n')
      )
      if (parsed.steps.length > 0) {
        return parsed
      }
    } catch (err) {
      this.logWorkflow('总理模型规划失败', String(err), 'warn')
      console.warn('[AIEngine] Premier dispatch failed, fallback to direct response:', err)
    }

    this.logWorkflow('总理模型规划降级', '使用单步 premier 直接回复。', 'warn')
    return {
      steps: [{ taskType: 'premier', instruction: '直接回答用户问题。', intent: '直接回复', useTools: true }],
      finalInstruction: '输出简洁、准确、可执行的最终答复。',
    }
  }

  private parseWorkChainPlan(raw: string): WorkChainPlan {
    const fallback: WorkChainPlan = {
      steps: [{ taskType: 'premier', instruction: '直接回答用户问题。', intent: '直接回复', useTools: true }],
      finalInstruction: '输出简洁、准确、可执行的最终答复。',
    }
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return fallback
    let parsed: any
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      return fallback
    }
    const stepsRaw = Array.isArray(parsed?.steps)
      ? parsed.steps
      : Array.isArray(parsed?.chain)
        ? parsed.chain
        : []
    const taskTypes: TaskType[] = [
      'roleplay',
      'context_compression',
      'memory_fragmentation',
      'vision',
      'code_generation',
      'premier',
    ]
    const steps: WorkChainStep[] = stepsRaw
      .map((item: any) => {
        const taskType = taskTypes.includes(item?.taskType) ? item.taskType : 'premier'
        const instruction = String(item?.instruction || '').trim()
        const intent = String(item?.intent || '').trim()
        const useTools = item?.useTools !== false
        return { taskType, instruction, intent, useTools }
      })
      .filter((item: WorkChainStep) => item.instruction || item.taskType === 'premier')
      .slice(0, 4)
    if (steps.length === 0) return fallback
    return {
      steps,
      finalInstruction: String(parsed?.finalInstruction || '').trim() || fallback.finalInstruction,
    }
  }

  private async executeWorkChain(
    steps: WorkChainStep[],
    preparedMessages: ChatMessage[],
    apiConfigId?: string,
    model?: string,
    tools: ToolDefinition[] = []
  ): Promise<StepExecutionResult[]> {
    const latestUserText = getLastUserMessage(preparedMessages)?.content || ''
    const results: StepExecutionResult[] = []
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index]
      const { apiConfig, modelName } = this.resolveModelRoute(step.taskType, apiConfigId, model)
      if (!apiConfig) {
        throw new Error('未配置可用 API，请先在设置页添加 API 配置。')
      }
      if (!modelName) {
        throw new Error(`任务类型 "${step.taskType}" 未配置模型，请在设置中配置。`)
      }
      this.abortController = new AbortController()

      const contextSnippet = results
        .map((item, idx) => {
          const toolPart =
            item.toolOutputs.length > 0
              ? `\n工具结果:\n${item.toolOutputs.map((x) => `- ${x.name}: ${x.content}`).join('\n')}`
              : ''
          return `步骤${idx + 1}(${item.taskType}/${item.modelName}): ${item.content}${toolPart}`
        })
        .join('\n\n')
      const stepPrompt = [
        `任务类型: ${step.taskType}`,
        `步骤目标: ${step.intent || '按指令完成'} `,
        `执行指令: ${step.instruction || '围绕用户需求完成该步骤。'}`,
        contextSnippet ? `已有步骤结果:\n${contextSnippet}` : '',
        `用户原始输入: ${latestUserText}`,
      ]
        .filter(Boolean)
        .join('\n\n')

      const stepMessages: ChatMessage[] = [
        {
          id: `step-system-${Date.now()}`,
          role: 'system',
          content:
            '你是工作流中的执行模型。请严格按执行指令输出该步骤结果；如果需要工具，调用 function tool。不要输出与当前步骤无关的内容。',
          timestamp: Date.now(),
        },
        {
          id: `step-user-${Date.now()}`,
          role: 'user',
          content: stepPrompt,
          timestamp: Date.now(),
        },
      ]
      this.logWorkflow(
        `步骤${index + 1}请求`,
        [
          `taskType=${step.taskType}`,
          `model=${modelName}`,
          `useTools=${step.useTools !== false}`,
          `stepPrompt:\n${stepPrompt}`,
          `stepMessages:\n${this.serializeMessages(stepMessages)}`,
        ].join('\n\n')
      )

      let response = await this.requestChatCompletion(
        apiConfig,
        this.buildRequestBody(modelName, stepMessages, step.useTools ? tools : [])
      )
      const message = response.choices?.[0]?.message
      const toolOutputs: Array<{ name: string; content: string; isError?: boolean }> = []
      if (step.useTools && message?.tool_calls && message.tool_calls.length > 0 && this.toolExecutor) {
        const toolMessages: ChatMessage[] = []
        this.logWorkflow(
          `步骤${index + 1}工具调用计划`,
          message.tool_calls
            .map((toolCall, callIndex) => `#${callIndex + 1} ${toolCall.function?.name} args=${toolCall.function?.arguments || '{}'}`)
            .join('\n')
        )
        for (const toolCall of message.tool_calls) {
          const name = toolCall.function?.name || ''
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(toolCall.function?.arguments || '{}')
          } catch {
            args = {}
          }
          const result = await this.toolExecutor(name, args)
          this.logWorkflow(
            `步骤${index + 1}工具调用结果`,
            [
              `tool=${name}`,
              `args=${JSON.stringify(args)}`,
              `isError=${Boolean(result.isError)}`,
              `content=\n${result.content || ''}`,
            ].join('\n')
          )
          toolOutputs.push({ name, content: result.content || '', isError: result.isError })
          toolMessages.push({
            id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'tool',
            content: result.content || '',
            timestamp: Date.now(),
            toolCallId: toolCall.id,
          })
        }
        const followUpMessages: ChatMessage[] = [
          ...stepMessages,
          {
            id: `assistant-tool-call-${Date.now()}`,
            role: 'assistant',
            content: message.content || '',
            timestamp: Date.now(),
            toolCalls: message.tool_calls.map((item) => ({
              id: item.id,
              name: item.function.name,
              arguments: (() => {
                try {
                  return JSON.parse(item.function.arguments || '{}')
                } catch {
                  return {}
                }
              })(),
            })),
          },
          ...toolMessages,
          {
            id: `step-followup-${Date.now()}`,
            role: 'system',
            content: '基于工具结果，输出该步骤的最终结果，避免重复。',
            timestamp: Date.now(),
          },
        ]
        response = await this.requestChatCompletion(
          apiConfig,
          this.buildRequestBody(modelName, followUpMessages, step.useTools ? tools : [])
        )
        this.logWorkflow(
          `步骤${index + 1}工具回填后续请求`,
          this.serializeMessages(followUpMessages)
        )
      }
      const stepResult = {
        taskType: step.taskType,
        modelName,
        instruction: step.instruction,
        content: response.choices?.[0]?.message?.content || '',
        toolOutputs,
      }
      this.logWorkflow(
        `步骤${index + 1}执行结果`,
        [
          `taskType=${stepResult.taskType}`,
          `model=${stepResult.modelName}`,
          `instruction=${stepResult.instruction}`,
          `content=\n${stepResult.content || ''}`,
          stepResult.toolOutputs.length > 0
            ? `toolOutputs=\n${stepResult.toolOutputs
                .map((item) => `${item.name}${item.isError ? '(error)' : ''}: ${item.content}`)
                .join('\n')}`
            : 'toolOutputs=none',
        ].join('\n\n')
      )
      results.push(stepResult)
    }
    return results
  }

  private async buildFinalResponse(
    plan: WorkChainPlan,
    preparedMessages: ChatMessage[],
    stepResults: StepExecutionResult[],
    apiConfigId?: string,
    model?: string
  ): Promise<ChatCompletionResponse> {
    const latestUserText = getLastUserMessage(preparedMessages)?.content || ''
    const summary = stepResults
      .map((item, idx) => {
        const toolPart =
          item.toolOutputs.length > 0
            ? `\n工具调用结果:\n${item.toolOutputs.map((x) => `- ${x.name}${x.isError ? '(失败)' : ''}: ${x.content}`).join('\n')}`
            : ''
        return `步骤${idx + 1}(${item.taskType}/${item.modelName})\n指令: ${item.instruction}\n结果: ${item.content}${toolPart}`
      })
      .join('\n\n')

    const { apiConfig, modelName } = this.resolveModelRoute('premier', apiConfigId, model)
    if (!apiConfig || !modelName) {
      const fallbackText =
        stepResults.map((item) => item.content).find((text) => String(text || '').trim().length > 0) || '未获得可用结果。'
      return {
        choices: [{ message: { role: 'assistant', content: fallbackText }, finish_reason: 'stop' }],
        meta: {
          model: stepResults[0]?.modelName || '',
          taskType: stepResults[0]?.taskType || 'premier',
        },
      }
    }
    const finalMessages: ChatMessage[] = [
      {
        id: `final-system-${Date.now()}`,
        role: 'system',
        content:
          '你是最终答复阶段的总理模型。请基于步骤结果给用户输出最终回复。必须忠实引用步骤与工具结果，不得编造未执行结果。',
        timestamp: Date.now(),
      },
      {
        id: `final-system-2-${Date.now()}`,
        role: 'system',
        content: `最终回复要求：${plan.finalInstruction || '输出简洁、准确、可执行的最终答复。'}`,
        timestamp: Date.now(),
      },
      {
        id: `final-user-${Date.now()}`,
        role: 'user',
        content: `用户原始请求：${latestUserText}\n\n工作流结果：\n${summary || '无'}`,
        timestamp: Date.now(),
      },
    ]
    this.logWorkflow(
      '最终汇总请求',
      [
        `model=${modelName}`,
        `plan=${JSON.stringify(plan, null, 2)}`,
        `stepSummary=\n${summary || '无'}`,
      ].join('\n\n')
    )
    const response = await this.requestChatCompletion(apiConfig, this.buildRequestBody(modelName, finalMessages, []))
    response.meta = {
      model: modelName,
      taskType: 'premier',
    }
    return response
  }

  private async buildPlannerInput(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    invokeContext?: InvokeContext
  ): Promise<string> {
    const allConfig = this.configManager.getAll()
    const latestUserText = getLastUserMessage(messages)?.content || ''
    const contextSummary = messages
      .filter((item) => item.role !== 'system')
      .slice(-8)
      .map((item) => `[${item.role}] ${item.content}`)
      .join('\n')
      .slice(0, 3500)
    const memorySummary =
      allConfig.agentChain.enableMemory && allConfig.memoryLayers.subconsciousEnabled
        ? this.memoryManager
            .retrieve(
              latestUserText,
              Math.max(2, allConfig.agentChain.memoryTopK || 4),
              allConfig.agentChain.memoryMinScore || 0.22,
              allConfig.agentChain.memoryDeduplicate !== false
            )
            .map((item, idx) => `${idx + 1}. ${item.text}`)
            .join('\n')
        : ''
    const toolSummary = this.serializeTools(tools)
    const fileSummary = await this.buildWatchFilesSnapshot(allConfig.watchFolders || [])
    const triggerSummary = invokeContext
      ? invokeContext.trigger === 'file_change' && invokeContext.fileChangeInfo
        ? `${invokeContext.trigger} | ${invokeContext.fileChangeInfo.type} | ${invokeContext.fileChangeInfo.filePath}`
        : invokeContext.trigger
      : 'text_input'

    return [
      `触发原因: ${triggerSummary}`,
      `用户最新输入:\n${latestUserText}`,
      `最近上下文摘要:\n${contextSummary || '无'}`,
      `潜意识记忆匹配:\n${memorySummary || '无'}`,
      `可用工具:\n${toolSummary || '无'}`,
      `可操作文件清单(来自监听目录):\n${fileSummary || '无'}`,
    ].join('\n\n')
  }

  private async buildWatchFilesSnapshot(folders: string[]): Promise<string> {
    const normalizedFolders = folders.map((item) => String(item || '').trim()).filter(Boolean)
    if (normalizedFolders.length === 0) return '无监听目录'
    const maxFiles = 120
    const maxDepth = 3
    const files: string[] = []
    const scan = async (root: string, current: string, depth: number) => {
      if (files.length >= maxFiles || depth > maxDepth) return
      let entries: fs.Dirent[] = []
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (files.length >= maxFiles) break
        const fullPath = path.join(current, entry.name)
        if (entry.isDirectory()) {
          await scan(root, fullPath, depth + 1)
          continue
        }
        if (entry.isFile()) {
          const relative = path.relative(root, fullPath).replace(/\\/g, '/')
          files.push(`${path.basename(root)}/${relative}`)
        }
      }
    }
    for (const folder of normalizedFolders) {
      await scan(folder, folder, 0)
      if (files.length >= maxFiles) break
    }
    return files.length > 0 ? files.join('\n') : '无可读文件'
  }

  private async prepareContext(messages: ChatMessage[], taskType: TaskType): Promise<PreparedContext> {
    const allConfig = this.configManager.getAll()
    let working = [...messages]

    if (allConfig.agentChain.enableRoundSummary) {
      const triggerTurns = Math.max(20, allConfig.agentChain.roundSummaryTriggerTurns || 100)
      const headTurns = Math.max(10, allConfig.agentChain.roundSummaryHeadTurns || 50)
      const hasRoundSummary = working.some((m) => m.role === 'system' && m.content.includes('[轮次摘要]'))
      if (!hasRoundSummary && nonSystemTurnCount(working) >= triggerTurns) {
        working = await this.roundSummarizeContext(working, headTurns)
      }
    }

    if (allConfig.agentChain.enableMemory) {
      if (allConfig.memoryLayers.instinctEnabled && allConfig.memoryLayers.instinctMemories.length > 0) {
        const instinctPrompt = allConfig.memoryLayers.instinctMemories
          .map((item, idx) => `${idx + 1}. ${item}`)
          .join('\n')
        working = [
          {
            id: `instinct-${Date.now()}`,
            role: 'system',
            content: `【本能层记忆】以下规则始终优先：\n${instinctPrompt}`,
            timestamp: Date.now(),
          },
          ...working,
        ]
      }

      const latest = getLastUserMessage(working)?.content || ''
      if (allConfig.memoryLayers.subconsciousEnabled) {
        const memories = this.memoryManager.retrieve(
          latest,
          allConfig.agentChain.memoryTopK,
          allConfig.agentChain.memoryMinScore,
          allConfig.agentChain.memoryDeduplicate
        )
        working = injectMemorySystemPrompt(working, memories)
      }
    }

    if (allConfig.agentChain.enableContextCompression) {
      if (shouldCompressContext(working, allConfig.agentChain.compressionThresholdTokens)) {
        working = await this.compressContext(working, allConfig.agentChain.compressionKeepRecentMessages)
      }
    }

    return { taskType, messages: working }
  }

  private async roundSummarizeContext(messages: ChatMessage[], headTurns: number): Promise<ChatMessage[]> {
    if (headTurns <= 0) return messages
    let nonSystemCount = 0
    let splitIndex = messages.length
    for (let i = 0; i < messages.length; i += 1) {
      if (messages[i].role !== 'system') {
        nonSystemCount += 1
      }
      if (nonSystemCount >= headTurns) {
        splitIndex = i + 1
        break
      }
    }
    if (splitIndex <= 0 || splitIndex >= messages.length) return messages

    const head = messages.slice(0, splitIndex)
    const tail = messages.slice(splitIndex)
    const serialized = head
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n')
      .slice(0, 12000)

    let summaryText = '已对早期上下文进行轮次摘要。'
    try {
      const { apiConfig, modelName } = this.resolveModelRoute('context_compression')
      if (apiConfig && modelName) {
        const response = await this.requestChatCompletion(apiConfig, {
          model: modelName,
          messages: [
            {
              role: 'system',
              content: '请将以下早期对话总结成结构化要点，重点保留用户偏好、约束、待办、已完成事项，100-180字。',
            },
            { role: 'user', content: serialized },
          ],
        })
        summaryText = response.choices?.[0]?.message?.content || summaryText
      }
    } catch {
      summaryText = `轮次摘要（降级）: ${serialized.slice(0, 220)}...`
    }

    return [
      {
        id: `round-summary-${Date.now()}`,
        role: 'system',
        content: `[轮次摘要] ${summaryText}`,
        timestamp: Date.now(),
      },
      ...tail,
    ]
  }

  private async compressContext(messages: ChatMessage[], keepRecentMessages: number): Promise<ChatMessage[]> {
    const safeKeep = Math.max(4, keepRecentMessages)
    if (messages.length <= safeKeep) return messages

    const head = messages.slice(0, messages.length - safeKeep)
    const tail = messages.slice(messages.length - safeKeep)
    const serialized = head
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n')
      .slice(0, 12000)

    let summaryText = '历史上下文较长，已进行压缩摘要。'
    try {
      const { apiConfig, modelName } = this.resolveModelRoute('context_compression')
      if (apiConfig && modelName) {
        const response = await this.requestChatCompletion(apiConfig, {
          model: modelName,
          messages: [
            {
              role: 'system',
              content: '请将以下对话历史压缩为要点，保留用户目标、约束、已完成和待完成事项，100-180字。',
            },
            {
              role: 'user',
              content: serialized,
            },
          ],
        })
        summaryText = response.choices?.[0]?.message?.content || summaryText
      }
    } catch {
      summaryText = `历史摘要（降级）: ${serialized.slice(0, 220)}...`
    }

    return [
      {
        id: `summary-${Date.now()}`,
        role: 'system',
        content: `这是历史对话压缩摘要，请保持一致性：${summaryText}`,
        timestamp: Date.now(),
      },
      ...tail,
    ]
  }

  private rememberIfNeeded(messages: ChatMessage[], assistantContent: string): void {
    const config = this.configManager.getAll()
    if (!config.agentChain.enableMemory) return

    const maxItems = config.agentChain.memoryMaxItems
    for (const msg of messages) {
      if (msg.role !== 'user') continue
      const candidates = pickMemoryCandidates(msg.content)
      for (const candidate of candidates) {
        this.memoryManager.remember(candidate, maxItems)
      }
    }

    const assistantCandidates = pickMemoryCandidates(assistantContent)
    for (const candidate of assistantCandidates) {
      this.memoryManager.remember(candidate, maxItems)
    }
  }

  private resolveCustomRequestBody(): Record<string, unknown> {
    const raw = this.configManager.getAll().modelRequestBody
    if (!isPlainObject(raw)) return {}
    const next = { ...raw }
    delete next.messages
    return next
  }

  private buildRequestBody(modelName: string, messages: ChatMessage[], tools?: ToolDefinition[]): ChatCompletionRequest {
    const baseBody: ChatCompletionRequest = {
      model: modelName,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            }
          : {}),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      })),
      ...(tools && tools.length > 0
        ? {
            tools: tools.map((t) => ({
              type: 'function' as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: {
                  type: 'object',
                  properties: t.parameters,
                  required: t.required || [],
                },
              },
            })),
          }
        : {}),
    }
    const customBody = this.resolveCustomRequestBody()
    return {
      ...customBody,
      ...baseBody,
    }
  }

  private async requestChatCompletion(
    apiConfig: ApiConfig,
    requestBody: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    this.logWorkflow('模型请求体(JSON)', JSON.stringify(requestBody, null, 2))
    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiConfig.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: this.abortController?.signal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API 请求失败（${response.status}）：${errorText}`)
    }

    const parsed = (await response.json()) as ChatCompletionResponse
    this.logWorkflow('模型响应体(JSON)', JSON.stringify(parsed, null, 2))
    return parsed
  }

  private resolveModelRoute(
    taskType: TaskType,
    apiConfigId?: string,
    model?: string
  ): { apiConfig: ApiConfig | null; modelName: string } {
    const allConfig = this.configManager.getAll()

    if (apiConfigId) {
      const apiConfig = allConfig.apiConfigs.find((c) => c.id === apiConfigId) || null
      return {
        apiConfig,
        modelName: model || apiConfig?.defaultModel || '',
      }
    }

    // Use the new modelAssignments
    const assignment = allConfig.modelAssignments?.[taskType]
    if (assignment?.apiConfigId && assignment?.model) {
      const apiConfig = allConfig.apiConfigs.find((c) => c.id === assignment.apiConfigId) || null
      if (apiConfig) {
        return {
          apiConfig,
          modelName: assignment.model,
        }
      }
    }

    // Fallback to first API config
    const fallbackApi = allConfig.apiConfigs[0] || null
    return {
      apiConfig: fallbackApi,
      modelName: model || fallbackApi?.defaultModel || '',
    }
  }

  abort(): void {
    this.abortController?.abort()
    this.abortController = null
  }
}
