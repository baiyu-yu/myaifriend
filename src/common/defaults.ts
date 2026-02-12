import { AppConfig } from './types'

export const DEFAULT_CONFIG: AppConfig = {
  apiConfigs: [],
  modelAssignments: {
    roleplay: { apiConfigId: '', model: '' },
    context_compression: { apiConfigId: '', model: '' },
    memory_fragmentation: { apiConfigId: '', model: '' },
    vision: { apiConfigId: '', model: '' },
    code_generation: { apiConfigId: '', model: '' },
    premier: { apiConfigId: '', model: '' },
  },
  characters: [
    {
      id: 'default',
      name: '默认助手',
      systemPrompt: '你是一个友好的 AI 助手，帮助用户高效完成任务。',
      greeting: '你好，我是你的 AI 助手。有什么我可以帮你？',
    },
  ],
  activeCharacterId: 'default',
  hotkeys: {
    toggleChat: 'CommandOrControl+Shift+A',
    toggleLive2D: 'CommandOrControl+Shift+L',
  },
  watchFolders: [],
  randomTimerRange: { min: 30, max: 120 },
  triggerPrompts: {
    hotkey: '用户通过快捷键唤起了你，请简短问候并询问需求。',
    click_avatar: '用户点击了你的形象，请给出自然、简短的回应。',
    random_timer: '请主动发起一段轻量对话，可以是提醒、建议或简短闲聊。',
    file_change: '监听目录发生文件变动：{{fileChangeInfo}}。请告知用户并询问是否需要处理。',
    text_input: '',
  },
  live2dModelPath: '',
  live2dActionMap: {
    expression: {},
    motion: {},
  },
  live2dBehavior: {
    enableIdleSway: true,
    idleSwayAmplitude: 8,
    idleSwaySpeed: 0.8,
    enableEyeTracking: false,
  },
  webSearch: {
    allowDomains: [],
    blockDomains: [],
  },
  toolToggles: {},
  memoryLayers: {
    instinctEnabled: true,
    instinctMemories: [],
    subconsciousEnabled: true,
    activeRecallEnabled: true,
  },
  agentChain: {
    enableContextCompression: true,
    compressionThresholdTokens: 3200,
    compressionKeepRecentMessages: 12,
    enableRoundSummary: true,
    roundSummaryTriggerTurns: 100,
    roundSummaryHeadTurns: 50,
    enableMemory: true,
    memoryTopK: 6,
    memoryMinScore: 0.22,
    memoryDeduplicate: true,
    memoryMaxItems: 500,
  },
  window: {
    chatWidth: 300,
    chatHeight: 380,
    live2dWidth: 300,
    live2dHeight: 400,
  },
}
