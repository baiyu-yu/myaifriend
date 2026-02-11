import { ConfigManager } from '../config-manager'
import { ApiConfig, ChatMessage, TaskType, ToolDefinition } from '../../common/types'

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
  stream?: boolean
  temperature?: number
  max_tokens?: number
}

interface ChatCompletionResponse {
  choices: Array<{
    message: ChatCompletionMessage
    finish_reason: string
  }>
}

export class AIEngine {
  private configManager: ConfigManager
  private abortController: AbortController | null = null

  constructor(configManager: ConfigManager) {
    this.configManager = configManager
  }

  /**
   * 发送对话请求。
   * 若未指定 apiConfigId / model，会根据任务类型自动路由。
   */
  async chat(
    messages: ChatMessage[],
    apiConfigId?: string,
    model?: string,
    taskType: TaskType = 'chat',
    tools?: ToolDefinition[]
  ): Promise<ChatCompletionResponse> {
    const { apiConfig, modelName } = this.resolveModelRoute(taskType, apiConfigId, model)

    if (!apiConfig) {
      throw new Error('未配置可用 API，请先在设置页添加 API 配置。')
    }

    this.abortController = new AbortController()

    const requestBody: ChatCompletionRequest = {
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

    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiConfig.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: this.abortController.signal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API 请求失败（${response.status}）：${errorText}`)
    }

    return response.json() as Promise<ChatCompletionResponse>
  }

  /**
   * 根据任务类型选择 API 与模型。
   * 优先级：显式指定 > 路由规则 > 第一个可用 API。
   */
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
