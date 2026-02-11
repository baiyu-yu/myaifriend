import { AppConfig } from './types'

export const DEFAULT_CONFIG: AppConfig = {
  apiConfigs: [],
  modelRoutes: [],
  characters: [
    {
      id: 'default',
      name: '默认助手',
      systemPrompt: '你是一个友好的AI助手，会帮助用户完成各种任务。',
      greeting: '你好！我是你的AI助手，有什么可以帮你的吗？'
    }
  ],
  activeCharacterId: 'default',
  hotkeys: {
    toggleChat: 'Alt+Space',
    toggleLive2D: 'Alt+L'
  },
  watchFolders: [],
  randomTimerRange: { min: 30, max: 120 },
  triggerPrompts: {
    hotkey: '用户通过快捷键唤起了你，请简短问候并询问需要什么帮助。',
    click_avatar: '用户点击了你的虚拟形象，请做出可爱的回应。',
    random_timer: '你主动发起了一次对话，可以分享一些有趣的事情、提醒用户休息，或者随便聊聊。',
    file_change: '用户监听的文件夹发生了变动：{{fileChangeInfo}}，请告知用户并询问是否需要处理。',
    text_input: ''
  },
  live2dModelPath: '',
  window: {
    chatWidth: 400,
    chatHeight: 600,
    live2dWidth: 300,
    live2dHeight: 400
  }
}
