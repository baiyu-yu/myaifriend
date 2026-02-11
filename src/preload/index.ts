import { contextBridge, ipcRenderer } from 'electron'
import { Conversation, IPC_CHANNELS, InvokeContext, Live2DAction } from '../common/types'

/** 暴露给渲染进程的 API */
const electronAPI = {
  // --- Config ---
  config: {
    get: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET, key),
    set: (key: string, value: unknown) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET, key, value),
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET_ALL),
  },

  // --- Chat ---
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

  // --- Tools ---
  tools: {
    execute: (name: string, args: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC_CHANNELS.TOOL_EXECUTE, name, args),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.TOOL_LIST),
  },

  // --- File Operations ---
  file: {
    read: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ, filePath),
    write: (filePath: string, content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_WRITE, filePath, content),
    list: (folderPath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_LIST, folderPath),
    openInBrowser: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN_IN_BROWSER, filePath),
  },

  // --- Live2D ---
  live2d: {
    action: (action: Live2DAction) => ipcRenderer.invoke(IPC_CHANNELS.LIVE2D_ACTION, action),
    loadModel: (modelPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.LIVE2D_LOAD_MODEL, modelPath),
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
  },

  // --- Window ---
  window: {
    toggleChat: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_TOGGLE_CHAT),
    toggleLive2D: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_TOGGLE_LIVE2D),
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
  },

  // --- Events from main process ---
  on: {
    fileWatchEvent: (callback: (event: { type: string; path: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { type: string; path: string }) =>
        callback(data)
      ipcRenderer.on(IPC_CHANNELS.FILE_WATCH_EVENT, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.FILE_WATCH_EVENT, listener)
    },
    triggerInvoke: (callback: (context: InvokeContext) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, ctx: InvokeContext) => callback(ctx)
      ipcRenderer.on(IPC_CHANNELS.TRIGGER_INVOKE, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TRIGGER_INVOKE, listener)
    },
  },

  // --- Dialog ---
  dialog: {
    selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_FOLDER),
    selectFile: (filters?: Electron.FileFilter[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_FILE, filters),
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
