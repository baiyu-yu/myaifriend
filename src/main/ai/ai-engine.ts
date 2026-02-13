import fs from 'fs'
import path from 'path'
import { ConfigManager } from '../config-manager'
import { ApiConfig, ChatMessage, InvokeContext, TaskType, ToolDefinition, ToolParameter, ToolResult } from '../../common/types'
import { MemoryManager } from './memory-manager'

interface ChatCompletionMessage {
  role: string
  content: string | null | Array<Record<string, unknown>>
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

type WorkerModelType = 'rp' | 'coder' | 'tool'

interface WorkflowTask {
  task_id: string
  model_type: WorkerModelType
  input_prompt: string
  dependencies: string[]
  use_tools: boolean
}

interface WorkflowPlan {
  workflow_id: string
  tasks: WorkflowTask[]
  final_intent: string
}

type TaskExecutionResult = {
  task_id: string
  model_type: WorkerModelType
  routeTaskType: TaskType
  modelName: string
  input_prompt: string
  dependencies: string[]
  output: string
  toolOutputs: Array<{ name: string; content: string; isError?: boolean }>
}

type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<ToolResult>
type WorkflowLogEmitter = (level: 'info' | 'warn' | 'error', message: string, source?: string) => void

const PREMIER_WORKFLOW_PROMPT = `You are the orchestrator model for a dependency-based workflow system.
You must decompose the user request into executable tasks with explicit dependencies.

Return ONLY JSON:
{
  "workflow_id": "wf_xxx",
  "tasks": [
    {
      "task_id": "task_a",
      "model_type": "rp|coder|tool",
      "input_prompt": "instruction for this worker",
      "dependencies": ["task_x"],
      "use_tools": true
    }
  ],
  "final_intent": "how to compose final user-facing answer"
}`

export function estimateTokens(messages: ChatMessage[]): number {
  return Math.ceil(messages.reduce((sum, item) => sum + item.content.length, 0) / 4)
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
  return messages.filter((message) => message.role !== 'system').length
}

export function injectMemorySystemPrompt(messages: ChatMessage[], memories: Array<{ text: string }>): ChatMessage[] {
  if (!memories.length) return messages
  const memoryPrompt = memories.map((item, index) => `${index + 1}. ${item.text}`).join('\n')
  return [
    {
      id: `memory-${Date.now()}`,
      role: 'system',
      content: `以下是与用户相关的长期记忆：\n${memoryPrompt}`,
      timestamp: Date.now(),
    },
    ...messages,
  ]
}

function pickMemoryCandidates(text: string): string[] {
  return text
    .split(/[\n。！？?!]/)
    .map((line) => line.trim())
    .filter((line) => /(remember|prefer|dont like|my name is|I am|我喜欢|我不喜欢|记住|偏好|我叫|我是)/i.test(line))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeWorkerModelType(input: unknown): WorkerModelType | null {
  const value = String(input || '')
    .trim()
    .toLowerCase()
  if (value === 'rp' || value === 'roleplay') return 'rp'
  if (value === 'coder' || value === 'code' || value === 'code_generation') return 'coder'
  if (value === 'tool' || value === 'tools' || value === 'vision' || value === 'premier') return 'tool'
  return null
}

function toBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true
    if (['false', '0', 'no', 'n'].includes(normalized)) return false
  }
  return fallback
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : `${text.slice(0, maxLen)}...`
}

export class AIEngine {
  private configManager: ConfigManager
  private memoryManager: MemoryManager
  private toolExecutor?: ToolExecutor
  private workflowLogger?: WorkflowLogEmitter
  private abortControllers: Set<AbortController> = new Set()

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

    this.logWorkflow('chat_start', {
      trigger: invokeContext?.trigger || 'text_input',
      incoming_messages: messages.length,
      prepared_messages: prepared.messages.length,
      tool_count: safeTools.length,
    })

    const plan = await this.dispatchViaPremier(prepared.messages, safeTools, invokeContext)
    const taskResults = await this.executeWorkflowPlan(plan, prepared.messages, apiConfigId, model, safeTools)
    const finalResponse = await this.buildFinalResponse(plan, prepared.messages, taskResults, apiConfigId, model)

    const assistantContent = finalResponse.choices?.[0]?.message?.content
    this.rememberIfNeeded(prepared.messages, typeof assistantContent === 'string' ? assistantContent : '')

    return finalResponse
  }

  private logWorkflow(event: string, payload: Record<string, unknown>, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.workflowLogger) return
    const summary = Object.entries(payload)
      .map(([key, value]) => `${key}=${typeof value === 'string' ? truncate(value.replace(/\s+/g, ' '), 240) : JSON.stringify(value)}`)
      .join(' | ')
    this.workflowLogger(level, `[workflow] ${event} | ${summary}`, 'chat-workflow')
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
        return `- ${tool.name}: ${tool.description} | params: ${params || 'none'}`
      })
      .join('\n')
  }

  private mapWorkerModelToTaskType(modelType: WorkerModelType, inputPrompt: string): TaskType {
    if (modelType === 'rp') return 'roleplay'
    if (modelType === 'coder') return 'code_generation'
    return /image|screenshot|vision|ocr|图片|图像|识别/.test(inputPrompt.toLowerCase()) ? 'vision' : 'premier'
  }

  private buildFallbackPlan(reason: string): WorkflowPlan {
    this.logWorkflow('plan_fallback', { reason }, 'warn')
    return {
      workflow_id: `wf-${Date.now().toString(36)}`,
      tasks: [
        {
          task_id: 'task_1',
          model_type: 'tool',
          input_prompt: 'Answer the user request directly and use tools only when required by the request.',
          dependencies: [],
          use_tools: true,
        },
      ],
      final_intent: 'Respond clearly and faithfully based on actual execution results.',
    }
  }

  private normalizeWorkflowPlan(raw: unknown): WorkflowPlan | null {
    if (!isPlainObject(raw)) return null
    const tasksRaw = Array.isArray(raw.tasks)
      ? raw.tasks
      : Array.isArray((raw as Record<string, unknown>).steps)
        ? ((raw as Record<string, unknown>).steps as unknown[])
        : []
    if (!tasksRaw.length) return null

    const taskIdSet = new Set<string>()
    const normalizedTasks: WorkflowTask[] = []
    for (let index = 0; index < tasksRaw.length; index += 1) {
      const item = tasksRaw[index]
      if (!isPlainObject(item)) continue
      const modelType =
        normalizeWorkerModelType(item.model_type) ||
        normalizeWorkerModelType(item.taskType) ||
        normalizeWorkerModelType(item.role)
      if (!modelType) continue
      const prompt = String(item.input_prompt || item.instruction || '').trim()
      if (!prompt) continue
      const taskId = String(item.task_id || `task_${index + 1}`).trim()
      if (!taskId || taskIdSet.has(taskId)) continue
      taskIdSet.add(taskId)

      const depsRaw = Array.isArray(item.dependencies)
        ? item.dependencies
        : Array.isArray(item.dependency)
          ? item.dependency
          : []
      const dependencies = depsRaw
        .map((dep) => String(dep || '').trim())
        .filter(Boolean)
        .filter((dep) => dep !== taskId)

      normalizedTasks.push({
        task_id: taskId,
        model_type: modelType,
        input_prompt: prompt,
        dependencies,
        use_tools: toBool(item.use_tools ?? item.useTools, modelType === 'tool'),
      })
      if (normalizedTasks.length >= 8) break
    }
    if (!normalizedTasks.length) return null

    const validTaskIds = new Set(normalizedTasks.map((task) => task.task_id))
    normalizedTasks.forEach((task) => {
      task.dependencies = task.dependencies.filter((dep) => validTaskIds.has(dep))
    })

    return {
      workflow_id: String(raw.workflow_id || raw.workflowId || `wf-${Date.now().toString(36)}`).trim(),
      tasks: normalizedTasks,
      final_intent: String(raw.final_intent || raw.finalInstruction || '').trim() || 'Respond clearly and accurately.',
    }
  }

  private extractJson(raw: string): unknown {
    const text = String(raw || '').trim()
    if (!text) return null
    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const candidate = fencedMatch ? fencedMatch[1] : text
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      return null
    }
  }

  private async dispatchViaPremier(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    invokeContext?: InvokeContext
  ): Promise<WorkflowPlan> {
    const latestUserText = getLastUserMessage(messages)?.content || ''
    if (!latestUserText.trim()) return this.buildFallbackPlan('empty_user_message')

    const { apiConfig, modelName } = this.resolveModelRoute('premier')
    if (!apiConfig || !modelName) return this.buildFallbackPlan('premier_route_unavailable')

    const plannerInput = await this.buildPlannerInput(messages, tools, invokeContext)
    try {
      const response = await this.requestChatCompletion(apiConfig, {
        model: modelName,
        messages: [
          { role: 'system', content: PREMIER_WORKFLOW_PROMPT },
          { role: 'user', content: plannerInput },
        ],
      })
      const rawContent = response.choices?.[0]?.message?.content
      const parsedPlan = this.normalizeWorkflowPlan(this.extractJson(typeof rawContent === 'string' ? rawContent : ''))
      if (parsedPlan) {
        this.logWorkflow('plan_created', {
          workflow_id: parsedPlan.workflow_id,
          task_count: parsedPlan.tasks.length,
          task_ids: parsedPlan.tasks.map((task) => task.task_id).join(','),
        })
        return parsedPlan
      }
      return this.buildFallbackPlan('planner_output_not_parseable')
    } catch (error) {
      this.logWorkflow('plan_error', { message: error instanceof Error ? error.message : String(error) }, 'warn')
      return this.buildFallbackPlan('planner_request_failed')
    }
  }
  private buildDependencySummary(dependencies: TaskExecutionResult[]): string {
    if (!dependencies.length) return 'none'
    return dependencies
      .map((item) => {
        const toolPart =
          item.toolOutputs.length > 0
            ? ` | tools=${item.toolOutputs.map((tool) => `${tool.name}${tool.isError ? '(error)' : ''}`).join(',')}`
            : ''
        return `${item.task_id}(${item.model_type}): ${truncate(item.output, 500)}${toolPart}`
      })
      .join('\n')
  }

  private buildPersonaHints(preparedMessages: ChatMessage[]): string {
    const systemMessages = preparedMessages
      .filter((item) => item.role === 'system')
      .map((item) => item.content.trim())
      .filter(Boolean)
    if (!systemMessages.length) return 'none'
    return truncate(systemMessages.join('\n\n'), 1200)
  }

  private buildTaskMessages(
    task: WorkflowTask,
    latestUserText: string,
    preparedMessages: ChatMessage[],
    dependencyResults: TaskExecutionResult[],
    finalIntent: string
  ): ChatMessage[] {
    const dependencySummary = this.buildDependencySummary(dependencyResults)
    const personaHints = this.buildPersonaHints(preparedMessages)

    let systemInstruction = ''
    let userInstruction = ''

    if (task.model_type === 'rp') {
      systemInstruction =
        'You are the RP worker. Produce user-facing text with tone/persona intent only. Do not include tool internals or code unless explicitly required.'
      userInstruction = [
        `final_intent: ${finalIntent}`,
        `persona_hints: ${personaHints}`,
        `task_instruction: ${task.input_prompt}`,
        `latest_user_message: ${latestUserText}`,
        `dependency_outputs:\n${dependencySummary}`,
      ].join('\n\n')
    } else if (task.model_type === 'coder') {
      systemInstruction =
        'You are the Coder worker. Focus on concrete technical output. Avoid conversational filler and avoid unrelated context.'
      userInstruction = [
        `task_instruction: ${task.input_prompt}`,
        `latest_user_message: ${latestUserText}`,
        `required_dependency_outputs:\n${dependencySummary}`,
      ].join('\n\n')
    } else {
      systemInstruction =
        'You are the Tool worker. Convert instruction into precise execution-oriented output. Call tools when needed and do not fabricate tool results.'
      userInstruction = [
        `task_instruction: ${task.input_prompt}`,
        `latest_user_message: ${latestUserText}`,
        `dependency_outputs:\n${dependencySummary}`,
      ].join('\n\n')
    }

    return [
      {
        id: `task-system-${task.task_id}-${Date.now()}`,
        role: 'system',
        content: systemInstruction,
        timestamp: Date.now(),
      },
      {
        id: `task-user-${task.task_id}-${Date.now()}`,
        role: 'user',
        content: userInstruction,
        timestamp: Date.now(),
      },
    ]
  }

  private async executeSingleTask(
    task: WorkflowTask,
    plan: WorkflowPlan,
    preparedMessages: ChatMessage[],
    completedMap: Map<string, TaskExecutionResult>,
    apiConfigId: string | undefined,
    model: string | undefined,
    tools: ToolDefinition[]
  ): Promise<TaskExecutionResult> {
    const routeTaskType = this.mapWorkerModelToTaskType(task.model_type, task.input_prompt)
    const { apiConfig, modelName } = this.resolveModelRoute(routeTaskType, apiConfigId, model)
    if (!apiConfig) throw new Error(`No API route found for task ${task.task_id} (${routeTaskType}).`)
    if (!modelName) throw new Error(`No model found for task ${task.task_id} (${routeTaskType}).`)

    const latestUserText = getLastUserMessage(preparedMessages)?.content || ''
    const dependencyResults = task.dependencies
      .map((dep) => completedMap.get(dep))
      .filter((item): item is TaskExecutionResult => Boolean(item))

    const taskMessages = this.buildTaskMessages(task, latestUserText, preparedMessages, dependencyResults, plan.final_intent)
    const shouldUseTools = task.use_tools && Boolean(this.toolExecutor) && tools.length > 0

    this.logWorkflow('task_start', {
      workflow_id: plan.workflow_id,
      task_id: task.task_id,
      model_type: task.model_type,
      route_task_type: routeTaskType,
      model: modelName,
      deps: task.dependencies.join(',') || 'none',
      use_tools: shouldUseTools,
    })

    let response = await this.requestChatCompletion(
      apiConfig,
      this.buildRequestBody(modelName, taskMessages, shouldUseTools ? tools : [])
    )

    const firstMessage = response.choices?.[0]?.message
    const toolOutputs: Array<{ name: string; content: string; isError?: boolean }> = []

    if (shouldUseTools && firstMessage?.tool_calls?.length && this.toolExecutor) {
      const toolMessages: ChatMessage[] = []
      for (const toolCall of firstMessage.tool_calls) {
        const name = toolCall.function?.name || ''
        let parsedArgs: Record<string, unknown> = {}
        try {
          parsedArgs = JSON.parse(toolCall.function?.arguments || '{}')
        } catch {
          parsedArgs = {}
        }

        const result = await this.toolExecutor(name, parsedArgs)
        toolOutputs.push({ name, content: result.content || '', isError: result.isError })
        toolMessages.push({
          id: `tool-${task.task_id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role: 'tool',
          content: result.content || '',
          timestamp: Date.now(),
          toolCallId: toolCall.id,
        })
      }

      const followUpMessages: ChatMessage[] = [
        ...taskMessages,
        {
          id: `assistant-tool-call-${task.task_id}-${Date.now()}`,
          role: 'assistant',
          content: (typeof firstMessage.content === 'string' ? firstMessage.content : '') || '',
          timestamp: Date.now(),
          toolCalls: firstMessage.tool_calls.map((item) => ({
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
          id: `tool-followup-${task.task_id}-${Date.now()}`,
          role: 'system',
          content: 'Based on tool outputs, provide the final result for this task. Do not repeat unnecessary text.',
          timestamp: Date.now(),
        },
      ]

      response = await this.requestChatCompletion(
        apiConfig,
        this.buildRequestBody(modelName, followUpMessages, shouldUseTools ? tools : [])
      )
    }

    const outputContent = response.choices?.[0]?.message?.content
    const output = typeof outputContent === 'string' ? outputContent : ''

    this.logWorkflow('task_done', {
      workflow_id: plan.workflow_id,
      task_id: task.task_id,
      output_length: output.length,
      tool_calls: toolOutputs.length,
      tool_errors: toolOutputs.filter((item) => item.isError).length,
    })

    return {
      task_id: task.task_id,
      model_type: task.model_type,
      routeTaskType,
      modelName,
      input_prompt: task.input_prompt,
      dependencies: [...task.dependencies],
      output,
      toolOutputs,
    }
  }

  private async executeWorkflowPlan(
    plan: WorkflowPlan,
    preparedMessages: ChatMessage[],
    apiConfigId?: string,
    model?: string,
    tools: ToolDefinition[] = []
  ): Promise<TaskExecutionResult[]> {
    const pending = new Map<string, WorkflowTask>(plan.tasks.map((task) => [task.task_id, { ...task }]))
    const completed = new Map<string, TaskExecutionResult>()
    const orderedTaskIds = plan.tasks.map((task) => task.task_id)

    let guard = 0
    while (pending.size > 0) {
      guard += 1
      if (guard > plan.tasks.length + 5) {
        this.logWorkflow('dag_guard_break', { workflow_id: plan.workflow_id, pending: Array.from(pending.keys()) }, 'warn')
        break
      }

      const runnable = Array.from(pending.values()).filter((task) =>
        task.dependencies.every((dependency) => completed.has(dependency))
      )

      const tasksToRun = runnable.length ? runnable : [Array.from(pending.values())[0]]
      if (!runnable.length) {
        this.logWorkflow(
          'dag_fallback_force_run',
          {
            workflow_id: plan.workflow_id,
            forced_task: tasksToRun[0].task_id,
            unresolved_dependencies: tasksToRun[0].dependencies,
          },
          'warn'
        )
      }

      const batchResults = await Promise.all(
        tasksToRun.map((task) =>
          this.executeSingleTask(task, plan, preparedMessages, completed, apiConfigId, model, tools)
        )
      )
      batchResults.forEach((result) => {
        completed.set(result.task_id, result)
        pending.delete(result.task_id)
      })
    }

    return orderedTaskIds
      .map((taskId) => completed.get(taskId))
      .filter((item): item is TaskExecutionResult => Boolean(item))
  }

  private async buildFinalResponse(
    plan: WorkflowPlan,
    preparedMessages: ChatMessage[],
    taskResults: TaskExecutionResult[],
    apiConfigId?: string,
    model?: string
  ): Promise<ChatCompletionResponse> {
    const latestUserText = getLastUserMessage(preparedMessages)?.content || ''

    const summary = taskResults
      .map((result) => {
        const toolPart =
          result.toolOutputs.length > 0
            ? `\nTool outputs:\n${result.toolOutputs
                .map((tool) => `- ${tool.name}${tool.isError ? ' (error)' : ''}: ${truncate(tool.content, 400)}`)
                .join('\n')}`
            : ''
        return [
          `Task ${result.task_id}`,
          `model_type: ${result.model_type}`,
          `route_task_type: ${result.routeTaskType}`,
          `instruction: ${truncate(result.input_prompt, 600)}`,
          `result: ${truncate(result.output, 1800)}`,
          toolPart,
        ]
          .filter(Boolean)
          .join('\n')
      })
      .join('\n\n')

    const { apiConfig, modelName } = this.resolveModelRoute('premier', apiConfigId, model)
    if (!apiConfig || !modelName) {
      const fallbackText =
        taskResults.map((item) => item.output).find((text) => String(text || '').trim().length > 0) ||
        'No usable result was produced.'
      return {
        choices: [{ message: { role: 'assistant', content: fallbackText }, finish_reason: 'stop' }],
        meta: {
          model: taskResults[0]?.modelName || '',
          taskType: taskResults[0]?.routeTaskType || 'premier',
        },
      }
    }

    const finalMessages: ChatMessage[] = [
      {
        id: `final-system-${Date.now()}`,
        role: 'system',
        content:
          'You are the orchestrator final synthesis stage. Build the final user response strictly from executed task outputs and tool results. Do not fabricate.',
        timestamp: Date.now(),
      },
      {
        id: `final-system-intent-${Date.now()}`,
        role: 'system',
        content: `final_intent: ${plan.final_intent}`,
        timestamp: Date.now(),
      },
      {
        id: `final-user-${Date.now()}`,
        role: 'user',
        content: `Original user request:\n${latestUserText}\n\nExecution log:\n${summary || 'none'}`,
        timestamp: Date.now(),
      },
    ]

    this.logWorkflow('final_synthesis', {
      workflow_id: plan.workflow_id,
      model: modelName,
      task_count: taskResults.length,
    })

    const response = await this.requestChatCompletion(apiConfig, this.buildRequestBody(modelName, finalMessages, []))
    response.meta = { model: modelName, taskType: 'premier' }
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
            .map((item, index) => `${index + 1}. ${item.text}`)
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
      `Trigger: ${triggerSummary}`,
      `Latest user input:\n${latestUserText}`,
      `Recent context summary:\n${contextSummary || 'none'}`,
      `Memory snippets:\n${memorySummary || 'none'}`,
      `Available tools:\n${toolSummary || 'none'}`,
      `Watchable files snapshot:\n${fileSummary || 'none'}`,
    ].join('\n\n')
  }

  private async buildWatchFilesSnapshot(folders: string[]): Promise<string> {
    const normalizedFolders = folders.map((item) => String(item || '').trim()).filter(Boolean)
    if (!normalizedFolders.length) return 'no watch folders'

    const maxFiles = 120
    const maxDepth = 3
    const files: string[] = []

    const scan = async (root: string, current: string, depth: number): Promise<void> => {
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
          files.push(`${path.basename(root)}/${path.relative(root, fullPath).replace(/\\/g, '/')}`)
        }
      }
    }

    for (const folder of normalizedFolders) {
      await scan(folder, folder, 0)
      if (files.length >= maxFiles) break
    }
    return files.length ? files.join('\n') : 'no readable files'
  }

  private async prepareContext(messages: ChatMessage[], taskType: TaskType): Promise<PreparedContext> {
    const allConfig = this.configManager.getAll()
    let working = [...messages]

    if (allConfig.agentChain.enableRoundSummary) {
      const triggerTurns = Math.max(20, allConfig.agentChain.roundSummaryTriggerTurns || 100)
      const headTurns = Math.max(10, allConfig.agentChain.roundSummaryHeadTurns || 50)
      const hasRoundSummary = working.some((message) => message.role === 'system' && message.content.includes('[round-summary]'))
      if (!hasRoundSummary && nonSystemTurnCount(working) >= triggerTurns) {
        working = await this.roundSummarizeContext(working, headTurns)
      }
    }

    if (allConfig.agentChain.enableMemory) {
      if (allConfig.memoryLayers.instinctEnabled && allConfig.memoryLayers.instinctMemories.length > 0) {
        const instinctPrompt = allConfig.memoryLayers.instinctMemories.map((item, index) => `${index + 1}. ${item}`).join('\n')
        working = [
          {
            id: `instinct-${Date.now()}`,
            role: 'system',
            content: `Core behavior rules:\n${instinctPrompt}`,
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
      if (messages[i].role !== 'system') nonSystemCount += 1
      if (nonSystemCount >= headTurns) {
        splitIndex = i + 1
        break
      }
    }
    if (splitIndex <= 0 || splitIndex >= messages.length) return messages

    const head = messages.slice(0, splitIndex)
    const tail = messages.slice(splitIndex)
    const serialized = head.map((message) => `[${message.role}] ${message.content}`).join('\n').slice(0, 12000)

    let summaryText = 'Early context was summarized.'
    try {
      const { apiConfig, modelName } = this.resolveModelRoute('context_compression')
      if (apiConfig && modelName) {
        const response = await this.requestChatCompletion(apiConfig, {
          model: modelName,
          messages: [
            {
              role: 'system',
              content:
                'Summarize early conversation as structured bullets. Keep user goals, constraints, pending tasks, and completed tasks. 100-180 words.',
            },
            { role: 'user', content: serialized },
          ],
        })
        const content = response.choices?.[0]?.message?.content
        if (typeof content === 'string' && content.trim()) summaryText = content
      }
    } catch {
      summaryText = `round-summary-fallback: ${truncate(serialized, 220)}`
    }

    return [
      {
        id: `round-summary-${Date.now()}`,
        role: 'system',
        content: `[round-summary] ${summaryText}`,
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
    const serialized = head.map((message) => `[${message.role}] ${message.content}`).join('\n').slice(0, 12000)

    let summaryText = 'History context was compressed.'
    try {
      const { apiConfig, modelName } = this.resolveModelRoute('context_compression')
      if (apiConfig && modelName) {
        const response = await this.requestChatCompletion(apiConfig, {
          model: modelName,
          messages: [
            {
              role: 'system',
              content:
                'Compress chat history into concise bullets. Keep user goals, constraints, done work, and remaining work. 100-180 words.',
            },
            { role: 'user', content: serialized },
          ],
        })
        const content = response.choices?.[0]?.message?.content
        if (typeof content === 'string' && content.trim()) summaryText = content
      }
    } catch {
      summaryText = `history-summary-fallback: ${truncate(serialized, 220)}`
    }

    return [
      {
        id: `summary-${Date.now()}`,
        role: 'system',
        content: `Compressed history summary: ${summaryText}`,
        timestamp: Date.now(),
      },
      ...tail,
    ]
  }

  private rememberIfNeeded(messages: ChatMessage[], assistantContent: string): void {
    const config = this.configManager.getAll()
    if (!config.agentChain.enableMemory) return
    const maxItems = config.agentChain.memoryMaxItems

    messages.forEach((message) => {
      if (message.role !== 'user') return
      pickMemoryCandidates(message.content).forEach((candidate) => this.memoryManager.remember(candidate, maxItems))
    })
    pickMemoryCandidates(assistantContent).forEach((candidate) => this.memoryManager.remember(candidate, maxItems))
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
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.toolCalls
          ? {
              tool_calls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: 'function' as const,
                function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
              })),
            }
          : {}),
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      })),
      ...(tools?.length
        ? {
            tools: tools.map((tool) => ({
              type: 'function' as const,
              function: {
                name: tool.name,
                description: tool.description,
                parameters: {
                  type: 'object',
                  properties: tool.parameters,
                  required: tool.required || [],
                },
              },
            })),
          }
        : {}),
    }

    return { ...this.resolveCustomRequestBody(), ...baseBody }
  }

  private async requestChatCompletion(apiConfig: ApiConfig, requestBody: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const controller = new AbortController()
    this.abortControllers.add(controller)
    try {
      const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiConfig.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`API request failed (${response.status}): ${await response.text()}`)
      }
      return (await response.json()) as ChatCompletionResponse
    } finally {
      this.abortControllers.delete(controller)
    }
  }

  private resolveModelRoute(
    taskType: TaskType,
    apiConfigId?: string,
    model?: string
  ): { apiConfig: ApiConfig | null; modelName: string } {
    const allConfig = this.configManager.getAll()

    if (apiConfigId) {
      const apiConfig = allConfig.apiConfigs.find((item) => item.id === apiConfigId) || null
      return { apiConfig, modelName: model || apiConfig?.defaultModel || '' }
    }

    const assignment = allConfig.modelAssignments?.[taskType]
    if (assignment?.apiConfigId && assignment?.model) {
      const apiConfig = allConfig.apiConfigs.find((item) => item.id === assignment.apiConfigId) || null
      if (apiConfig) return { apiConfig, modelName: assignment.model }
    }

    const fallbackApi = allConfig.apiConfigs[0] || null
    return { apiConfig: fallbackApi, modelName: model || fallbackApi?.defaultModel || '' }
  }

  abort(): void {
    for (const controller of this.abortControllers) controller.abort()
    this.abortControllers.clear()
  }
}

