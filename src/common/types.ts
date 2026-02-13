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
  | 'roleplay'
  | 'context_compression'
  | 'memory_fragmentation'
  | 'vision'
  | 'code_generation'
  | 'premier'

export interface ModelRouteRule {
  id: string
  name: string
  taskType: TaskType
  apiConfigId: string
  model: string
}

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  roleplay: '角色扮演',
  context_compression: '上下文压缩',
  memory_fragmentation: '记忆及知识库碎片化',
  vision: '图像识别',
  code_generation: '代码编写',
  premier: '总理模型',
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
  inference?: {
    model: string
    taskType: TaskType
  }
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
  enabled?: boolean
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

export interface Live2DModelRecord {
  path: string
  label: string
  lastUsedAt: number
}

export interface AppLogEntry {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error'
  source: string
  message: string
}

export interface AppStorageInfo {
  currentDir: string
}

// --- App Config ---
export interface AppConfig {
  apiConfigs: ApiConfig[]
  modelAssignments: Record<TaskType, { apiConfigId: string; model: string }>
  characters: CharacterConfig[]
  activeCharacterId: string
  hotkeys: {
    toggleChat: string
    toggleLive2D: string
    toggleLive2DControls: string
  }
  modelRequestBody: Record<string, unknown>
  watchFolders: string[]
  randomTimerRange: { min: number; max: number }
  triggerPrompts: Record<InvokeTrigger, string>
  live2dModelPath: string
  live2dActionMap: Live2DActionMap
  live2dModelActionMaps: Record<string, Live2DActionMap>
  live2dModels: Live2DModelRecord[]
  live2dModelTransforms: Record<string, { x: number; y: number; scale: number }>
  live2dBehavior: {
    enableIdleSway: boolean
    idleSwayAmplitude: number
    idleSwaySpeed: number
    enableEyeTracking: boolean
  }
  live2dControls: {
    visible: boolean
    x: number
    y: number
  }
  webSearch: {
    allowDomains: string[]
    blockDomains: string[]
  }
  toolToggles: Record<string, boolean>
  memoryLayers: {
    instinctEnabled: boolean
    instinctMemories: string[]
    subconsciousEnabled: boolean
    activeRecallEnabled: boolean
  }
  agentChain: {
    enableContextCompression: boolean
    compressionThresholdTokens: number
    compressionKeepRecentMessages: number
    enableRoundSummary: boolean
    roundSummaryTriggerTurns: number
    roundSummaryHeadTurns: number
    enableMemory: boolean
    memoryTopK: number
    memoryMinScore: number
    memoryDeduplicate: boolean
    memoryMaxItems: number
  }
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

  // Memory
  MEMORY_LIST: 'memory:list',
  MEMORY_DELETE: 'memory:delete',
  MEMORY_CLEAR: 'memory:clear',
  MEMORY_MERGE: 'memory:merge',

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
  LIVE2D_SHOW_REPLY: 'live2d:showReply',
  LIVE2D_BEHAVIOR_UPDATE: 'live2d:behaviorUpdate',
  LIVE2D_CONTROLS_UPDATE: 'live2d:controlsUpdate',

  // Window
  WINDOW_TOGGLE_CHAT: 'window:toggleChat',
  WINDOW_SHOW_CHAT: 'window:showChat',
  WINDOW_TOGGLE_LIVE2D: 'window:toggleLive2D',
  WINDOW_SHOW_LIVE2D: 'window:showLive2D',
  WINDOW_OPEN_SETTINGS: 'window:openSettings',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_DRAG_BEGIN: 'window:dragBegin',
  WINDOW_DRAG_UPDATE: 'window:dragUpdate',
  WINDOW_DRAG_END: 'window:dragEnd',
  WINDOW_SET_MOUSE_PASSTHROUGH: 'window:setMousePassthrough',
  WINDOW_RESIZE_BEGIN: 'window:resizeBegin',
  WINDOW_RESIZE_UPDATE: 'window:resizeUpdate',
  WINDOW_RESIZE_END: 'window:resizeEnd',

  // File Watcher
  FILE_WATCH_EVENT: 'fileWatch:event',

  // Trigger
  TRIGGER_INVOKE: 'trigger:invoke',

  // Dialog
  DIALOG_SELECT_FOLDER: 'dialog:selectFolder',
  DIALOG_SELECT_FILE: 'dialog:selectFile',
  DIALOG_SELECT_PATH: 'dialog:selectPath',

  // App
  APP_GET_META: 'app:getMeta',
  APP_LOG_LIST: 'app:log:list',
  APP_LOG_CLEAR: 'app:log:clear',
  APP_LOG_ADD: 'app:log:add',
  APP_STORAGE_INFO: 'app:storage:info',
  APP_STORAGE_SET: 'app:storage:set',
} as const
