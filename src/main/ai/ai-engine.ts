import { ConfigManager } from '../config-manager'
import { ApiConfig, ChatMessage, TaskType, ToolDefinition } from '../../common/types'
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
}

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

const PREMIER_DISPATCH_PROMPT = `你是一个任务调度器（总理模型）。根据用户的输入，分析需要执行的工作链步骤。

可用的任务类型：
- roleplay: 角色扮演对话
- context_compression: 上下文压缩
- memory_fragmentation: 记忆及知识库碎片化处理
- vision: 图像识别
- code_generation: 代码编写（特指HTML）
- premier: 直接由总理模型回答

请以JSON格式返回工作链，格式如下：
{"chain": [{"taskType": "类型", "instruction": "给该步骤模型的具体指令"}]}

注意：
1. 大多数普通对话直接返回 premier 类型即可
2. 只有明确需要特定能力时才拆分工作链
3. chain数组按执行顺序排列
4. 每个步骤的instruction应包含完整的上下文信息

只返回JSON，不要其他内容。`

export class AIEngine {
  private configManager: ConfigManager
  private memoryManager: MemoryManager
  private abortController: AbortController | null = null

  constructor(configManager: ConfigManager) {
    this.configManager = configManager
    this.memoryManager = new MemoryManager()
  }

  async chat(
    messages: ChatMessage[],
    apiConfigId?: string,
    model?: string,
    taskType: TaskType = 'premier',
    tools?: ToolDefinition[]
  ): Promise<ChatCompletionResponse> {
    const allConfig = this.configManager.getAll()
    const chain = allConfig.agentChain

    const prepared = await this.prepareContext(messages, taskType)

    // Use premier model to determine work chain
    const workChain = await this.dispatchViaPremier(prepared.messages)

    let finalResponse: ChatCompletionResponse | null = null
    let accumulatedContext = [...prepared.messages]

    for (const step of workChain) {
      const { apiConfig, modelName } = this.resolveModelRoute(step.taskType, apiConfigId, model)

      if (!apiConfig) {
        throw new Error('未配置可用 API，请先在设置页添加 API 配置。')
      }
      if (!modelName) {
        throw new Error(`任务类型 "${step.taskType}" 未配置模型，请在设置中配置。`)
      }

      this.abortController = new AbortController()

      // If there's a specific instruction from the premier model, inject it
      const stepMessages: ChatMessage[] = step.instruction
        ? [
            ...accumulatedContext.filter((m) => m.role === 'system'),
            {
              id: `chain-${Date.now()}`,
              role: 'system' as const,
              content: `当前任务指令：${step.instruction}`,
              timestamp: Date.now(),
            },
            ...accumulatedContext.filter((m) => m.role !== 'system'),
          ]
        : accumulatedContext

      const requestBody = this.buildRequestBody(modelName, stepMessages, tools)
      finalResponse = await this.requestChatCompletion(apiConfig, requestBody)

      const assistantContent = finalResponse.choices?.[0]?.message?.content || ''

      // Accumulate the response for multi-step chains
      if (workChain.length > 1 && assistantContent) {
        accumulatedContext.push({
          id: `step-result-${Date.now()}`,
          role: 'assistant',
          content: assistantContent,
          timestamp: Date.now(),
        })
      }

      finalResponse.meta = {
        model: modelName,
        taskType: step.taskType,
      }
    }

    if (!finalResponse) {
      throw new Error('工作链为空，无法生成回复。')
    }

    const assistantContent = finalResponse.choices?.[0]?.message?.content || ''
    this.rememberIfNeeded(prepared.messages, assistantContent)
    return finalResponse
  }

  private async dispatchViaPremier(messages: ChatMessage[]): Promise<WorkChainStep[]> {
    const { apiConfig, modelName } = this.resolveModelRoute('premier')

    if (!apiConfig || !modelName) {
      // No premier model configured, fallback to direct premier response
      return [{ taskType: 'premier', instruction: '' }]
    }

    const latestUserText = getLastUserMessage(messages)?.content || ''
    if (!latestUserText.trim()) {
      return [{ taskType: 'premier', instruction: '' }]
    }

    try {
      const response = await this.requestChatCompletion(apiConfig, {
        model: modelName,
        messages: [
          { role: 'system', content: PREMIER_DISPATCH_PROMPT },
          { role: 'user', content: latestUserText },
        ],
      })

      const raw = response.choices?.[0]?.message?.content || ''
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed.chain) && parsed.chain.length > 0) {
          return parsed.chain.map((step: any) => ({
            taskType: step.taskType || 'premier',
            instruction: step.instruction || '',
          }))
        }
      }
    } catch (err) {
      console.warn('[AIEngine] Premier dispatch failed, falling back to direct response:', err)
    }

    return [{ taskType: 'premier', instruction: '' }]
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

  private buildRequestBody(modelName: string, messages: ChatMessage[], tools?: ToolDefinition[]): ChatCompletionRequest {
    return {
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
  }

  private async requestChatCompletion(
    apiConfig: ApiConfig,
    requestBody: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
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

    return response.json() as Promise<ChatCompletionResponse>
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
