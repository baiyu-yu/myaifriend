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

export type TaskType =
  | 'chat'
  | 'roleplay'
  | 'tool_call'
  | 'file_operation'
  | 'summary'
  | 'translation'

export interface ModelRouteRule {
  id: string
  name: string
  taskTypes: TaskType[]
  apiConfigId: string
  model: string
  priority: number
}

// --- Character ---
export interface CharacterConfig {
  id: string
  name: string
  avatar?: string
  systemPrompt: string
  greeting?: string
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

// --- Trigger ---
export type InvokeTrigger =
  | 'hotkey'
  | 'click_avatar'
  | 'random_timer'
  | 'file_change'
  | 'text_input'

export interface InvokeContext {
  trigger: InvokeTrigger
  fileChangeInfo?: {
    type: 'add' | 'change' | 'unlink'
    filePath: string
  }
}

// --- Live2D ---
export interface Live2DAction {
  type: 'expression' | 'motion' | 'speak'
  name: string
  priority?: number
}

export interface Live2DActionMap {
  expression: Record<string, string>
  motion: Record<string, string>
}

// --- App Config ---
export interface AppConfig {
  apiConfigs: ApiConfig[]
  modelRoutes: ModelRouteRule[]
  characters: CharacterConfig[]
  activeCharacterId: string
  hotkeys: {
    toggleChat: string
    toggleLive2D: string
  }
  watchFolders: string[]
  randomTimerRange: { min: number; max: number }
  triggerPrompts: Record<InvokeTrigger, string>
  live2dModelPath: string
  live2dActionMap: Live2DActionMap
  window: {
    chatWidth: number
    chatHeight: number
    live2dWidth: number
    live2dHeight: number
  }
}

// --- IPC Channels ---
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
