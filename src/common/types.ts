// ===== Common Type Definitions =====

// --- API & Model Configuration ---
export interface ApiConfig {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  defaultModel: string
  availableModels: string[]
}

export interface ModelRouteRule {
  id: string
  name: string
  /** 匹配的任务类型 */
  taskTypes: TaskType[]
  /** 使用的 API 配置 ID */
  apiConfigId: string
  /** 使用的模型名称 */
  model: string
  /** 优先级, 数字越小优先级越高 */
  priority: number
}

export type TaskType =
  | 'chat'           // 普通对话
  | 'roleplay'       // 角色扮演
  | 'tool_call'      // 工具调用决策
  | 'file_operation'  // 文件操作
  | 'summary'        // 摘要/总结
  | 'translation'    // 翻译

// --- Character / Role Play ---
export interface CharacterConfig {
  id: string
  name: string
  avatar?: string
  systemPrompt: string
  greeting?: string
  /** Live2D 模型路径 */
  live2dModelPath?: string
}

// --- Conversation ---
export interface ChatMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
  toolCalls?: ToolCall[]
  toolCallId?: string
}

export interface Conversation {
  id: string
  characterId: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface ConversationSummary {
  id: string
  title: string
  characterId: string
  updatedAt: number
  messageCount: number
}

// --- Tool System ---
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, ToolParameter>
  required?: string[]
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description: string
  enum?: string[]
  items?: ToolParameter
  properties?: Record<string, ToolParameter>
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  content: string
  isError?: boolean
}

// --- Trigger / Invoke Types ---
export type InvokeTrigger =
  | 'hotkey'          // 快捷键唤起
  | 'click_avatar'    // 点击虚拟形象
  | 'random_timer'    // 随机定时
  | 'file_change'     // 文件变动
  | 'text_input'      // 文本框输入

export interface InvokeContext {
  trigger: InvokeTrigger
  /** 文件变动时的额外信息 */
  fileChangeInfo?: {
    type: 'add' | 'change' | 'unlink'
    filePath: string
  }
}

// --- Live2D ---
export interface Live2DAction {
  type: 'expression' | 'motion' | 'speak'
  name: string
  /** motion 的优先级 */
  priority?: number
}

// --- App Config ---
export interface AppConfig {
  /** API 配置列表 */
  apiConfigs: ApiConfig[]
  /** 模型路由规则 */
  modelRoutes: ModelRouteRule[]
  /** 角色配置列表 */
  characters: CharacterConfig[]
  /** 当前使用的角色 ID */
  activeCharacterId: string
  /** 快捷键配置 */
  hotkeys: {
    toggleChat: string
    toggleLive2D: string
  }
  /** 监听的文件夹路径 */
  watchFolders: string[]
  /** 随机唤起的时间范围(分钟) */
  randomTimerRange: { min: number; max: number }
  /** 各种唤起方式的提示词模板 */
  triggerPrompts: Record<InvokeTrigger, string>
  /** Live2D 模型路径 */
  live2dModelPath: string
  /** 窗口配置 */
  window: {
    chatWidth: number
    chatHeight: number
    live2dWidth: number
    live2dHeight: number
  }
}

// --- IPC Channel Definitions ---
export const IPC_CHANNELS = {
  // Config
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  CONFIG_GET_ALL: 'config:getAll',

  // AI Chat
  CHAT_SEND: 'chat:send',
  CHAT_STREAM: 'chat:stream',
  CHAT_ABORT: 'chat:abort',
  CHAT_HISTORY_LIST: 'chat:history:list',
  CHAT_HISTORY_GET: 'chat:history:get',
  CHAT_HISTORY_CREATE: 'chat:history:create',
  CHAT_HISTORY_SAVE: 'chat:history:save',
  CHAT_HISTORY_DELETE: 'chat:history:delete',

  // Tool
  TOOL_EXECUTE: 'tool:execute',
  TOOL_LIST: 'tool:list',

  // File Operations
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_LIST: 'file:list',
  FILE_OPEN_IN_BROWSER: 'file:openInBrowser',

  // Live2D
  LIVE2D_ACTION: 'live2d:action',
  LIVE2D_LOAD_MODEL: 'live2d:loadModel',

  // Window
  WINDOW_TOGGLE_CHAT: 'window:toggleChat',
  WINDOW_TOGGLE_LIVE2D: 'window:toggleLive2D',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_CLOSE: 'window:close',

  // File Watcher
  FILE_WATCH_EVENT: 'fileWatch:event',

  // Trigger
  TRIGGER_INVOKE: 'trigger:invoke',

  // Dialog
  DIALOG_SELECT_FOLDER: 'dialog:selectFolder',
  DIALOG_SELECT_FILE: 'dialog:selectFile',
} as const
