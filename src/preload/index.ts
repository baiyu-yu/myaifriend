import { contextBridge, ipcRenderer } from 'electron'
import { Conversation, IPC_CHANNELS, InvokeContext, Live2DAction } from '../common/types'

/** 暴露给渲染进程的 API */
const electronAPI = {
  config: {
    get: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET, key),
    set: (key: string, value: unknown) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET, key, value),
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET_ALL),
  },

  chat: {
    send: (messages: unknown[], apiConfigId?: string, model?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_SEND, messages, apiConfigId, model),
    onStream: (callback: (chunk: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, chunk: string) => callback(chunk)
      ipcRenderer.on(IPC_CHANNELS.CHAT_STREAM, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_STREAM, listener)
    },
    abort: () => ipcRenderer.invoke(IPC_CHANNELS.CHAT_ABORT),
    historyList: () => ipcRenderer.invoke(IPC_CHANNELS.CHAT_HISTORY_LIST),
    historyGet: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CHAT_HISTORY_GET, id),
    historyCreate: (conversation: Conversation) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_HISTORY_CREATE, conversation),
    historySave: (conversation: Conversation) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_HISTORY_SAVE, conversation),
    historyDelete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CHAT_HISTORY_DELETE, id),
  },

  memory: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.MEMORY_LIST),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MEMORY_DELETE, id),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.MEMORY_CLEAR),
    merge: (ids: string[]) => ipcRenderer.invoke(IPC_CHANNELS.MEMORY_MERGE, ids),
  },

  tools: {
    execute: (name: string, args: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC_CHANNELS.TOOL_EXECUTE, name, args),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.TOOL_LIST),
  },

  file: {
    read: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ, filePath),
    write: (filePath: string, content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_WRITE, filePath, content),
    list: (folderPath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_LIST, folderPath),
    openInBrowser: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN_IN_BROWSER, filePath),
  },

  live2d: {
    action: (action: Live2DAction) => ipcRenderer.invoke(IPC_CHANNELS.LIVE2D_ACTION, action),
    loadModel: (modelPath: string) => ipcRenderer.invoke(IPC_CHANNELS.LIVE2D_LOAD_MODEL, modelPath),
    showReply: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.LIVE2D_SHOW_REPLY, text),
    onAction: (callback: (action: Live2DAction) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, action: Live2DAction) => callback(action)
      ipcRenderer.on(IPC_CHANNELS.LIVE2D_ACTION, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.LIVE2D_ACTION, listener)
    },
    onLoadModel: (callback: (modelPath: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, modelPath: string) => callback(modelPath)
      ipcRenderer.on(IPC_CHANNELS.LIVE2D_LOAD_MODEL, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.LIVE2D_LOAD_MODEL, listener)
    },
    onShowReply: (callback: (text: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, text: string) => callback(text)
      ipcRenderer.on(IPC_CHANNELS.LIVE2D_SHOW_REPLY, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.LIVE2D_SHOW_REPLY, listener)
    },
  },

  window: {
    toggleChat: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_TOGGLE_CHAT),
    showChat: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_SHOW_CHAT),
    toggleLive2D: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_TOGGLE_LIVE2D),
    showLive2D: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_SHOW_LIVE2D),
    openSettings: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_SETTINGS),
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
  },

  on: {
    fileWatchEvent: (callback: (event: { type: string; path: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { type: string; path: string }) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.FILE_WATCH_EVENT, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.FILE_WATCH_EVENT, listener)
    },
    triggerInvoke: (callback: (context: InvokeContext) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, ctx: InvokeContext) => callback(ctx)
      ipcRenderer.on(IPC_CHANNELS.TRIGGER_INVOKE, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TRIGGER_INVOKE, listener)
    },
  },

  trigger: {
    invoke: (context: InvokeContext) => ipcRenderer.invoke(IPC_CHANNELS.TRIGGER_INVOKE, context),
  },

  dialog: {
    selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_FOLDER),
    selectFile: (filters?: Electron.FileFilter[]) => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_FILE, filters),
    selectPath: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_PATH),
  },

  app: {
    getMeta: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_META),
    log: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.APP_LOG_LIST),
      clear: () => ipcRenderer.invoke(IPC_CHANNELS.APP_LOG_CLEAR),
      add: (level: 'info' | 'warn' | 'error', message: string, source?: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.APP_LOG_ADD, level, message, source),
    },
    storage: {
      info: () => ipcRenderer.invoke(IPC_CHANNELS.APP_STORAGE_INFO),
      set: (dirPath: string) => ipcRenderer.invoke(IPC_CHANNELS.APP_STORAGE_SET, dirPath),
    },
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
