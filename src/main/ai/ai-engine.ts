import { ConfigManager } from '../config-manager'
import { ApiConfig, ChatMessage, TaskClassifierRule, TaskType, ToolDefinition } from '../../common/types'
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

export function inferTaskTypeByText(text: string): TaskType {
  const normalized = text.toLowerCase()

  const hasImageSignal =
    /!\[.*\]\(.*\)/.test(text) ||
    /(https?:\/\/\S+\.(png|jpg|jpeg|webp|gif))/i.test(text) ||
    /(data:image\/[a-z+]+;base64,)/i.test(text) ||
    /(识别图片|图里|看图|图像|ocr|image)/i.test(text)
  if (hasImageSignal) return 'vision'

  if (/(翻译|translate|译为)/i.test(text)) return 'translation'
  if (/(总结|摘要|归纳|总结一下)/i.test(text)) return 'summary'
  if (/(读取文件|写入文件|文件夹|目录|path|\\.txt|\\.md|\\.json)/i.test(text)) return 'file_operation'
  if (/(扮演|角色扮演|你现在是|请你饰演)/i.test(text)) return 'roleplay'
  if (/(调用工具|使用工具|tool)/i.test(text)) return 'tool_call'

  return normalized.length > 0 ? 'chat' : 'chat'
}

export function inferTaskTypeByRules(text: string, rules: TaskClassifierRule[]): TaskType | null {
  const sortedRules = [...rules]
    .filter((rule) => rule.enabled && rule.pattern.trim())
    .sort((a, b) => a.priority - b.priority)

  for (const rule of sortedRules) {
    try {
      const re = new RegExp(rule.pattern, 'i')
      if (re.test(text)) return rule.taskType
    } catch {
      // Ignore invalid user regex and continue with next rule.
    }
  }
  return null
}

export function shouldCompressContext(messages: ChatMessage[], thresholdTokens: number): boolean {
  return estimateTokens(messages) > thresholdTokens
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
    taskType: TaskType = 'chat',
    tools?: ToolDefinition[]
  ): Promise<ChatCompletionResponse> {
    const allConfig = this.configManager.getAll()
    const chain = allConfig.agentChain
    const latestUserText = getLastUserMessage(messages)?.content || ''
    const inferredTask = chain.enableAutoTaskRouting
      ? inferTaskTypeByRules(latestUserText, chain.taskClassifierRules) || inferTaskTypeByText(latestUserText)
      : taskType

    const prepared = await this.prepareContext(messages, inferredTask)
    const { apiConfig, modelName } = this.resolveModelRoute(prepared.taskType, apiConfigId, model)

    if (!apiConfig) {
      throw new Error('未配置可用 API，请先在设置页添加 API 配置。')
    }
    if (!modelName) {
      throw new Error('当前任务未匹配到模型，请先在模型路由中配置。')
    }

    this.abortController = new AbortController()
    const requestBody = this.buildRequestBody(modelName, prepared.messages, tools)
    const response = await this.requestChatCompletion(apiConfig, requestBody)

    const assistantContent = response.choices?.[0]?.message?.content || ''
    this.rememberIfNeeded(prepared.messages, assistantContent)
    response.meta = {
      model: modelName,
      taskType: prepared.taskType,
    }
    return response
  }

  private async prepareContext(messages: ChatMessage[], taskType: TaskType): Promise<PreparedContext> {
    const allConfig = this.configManager.getAll()
    let working = [...messages]

    if (allConfig.agentChain.enableMemory) {
      const latest = getLastUserMessage(working)?.content || ''
      const memories = this.memoryManager.retrieve(
        latest,
        allConfig.agentChain.memoryTopK,
        allConfig.agentChain.memoryMinScore,
        allConfig.agentChain.memoryDeduplicate
      )
      working = injectMemorySystemPrompt(working, memories)
    }

    if (allConfig.agentChain.enableContextCompression) {
      if (shouldCompressContext(working, allConfig.agentChain.compressionThresholdTokens)) {
        working = await this.compressContext(working, allConfig.agentChain.compressionKeepRecentMessages)
      }
    }

    return { taskType, messages: working }
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
      const { apiConfig, modelName } = this.resolveModelRoute('summary')
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

    const matchedRoutes = allConfig.modelRoutes
      .filter((r) => r.taskTypes.includes(taskType))
      .sort((a, b) => a.priority - b.priority)

    if (matchedRoutes.length > 0) {
      const route = matchedRoutes[0]
      const apiConfig = allConfig.apiConfigs.find((c) => c.id === route.apiConfigId) || null
      return {
        apiConfig,
        modelName: route.model,
      }
    }

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
