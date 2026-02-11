import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  dialog,
  shell,
  Tray,
  Menu,
  nativeImage,
} from 'electron'
import path from 'path'
import { ConfigManager } from './config-manager'
import { ConversationManager } from './conversation-manager'
import { ToolManager } from './tools/tool-manager'
import { FileWatcher } from './file-watcher'
import { AIEngine } from './ai/ai-engine'
import { IPC_CHANNELS, InvokeContext } from '../common/types'

class Application {
  private mainWindow: BrowserWindow | null = null
  private chatWindow: BrowserWindow | null = null
  private live2dWindow: BrowserWindow | null = null
  private tray: Tray | null = null

  private configManager!: ConfigManager
  private toolManager!: ToolManager
  private conversationManager!: ConversationManager
  private fileWatcher!: FileWatcher
  private aiEngine!: AIEngine

  private randomTimer: NodeJS.Timeout | null = null
  private isQuitting = false

  async init() {
    await app.whenReady()

    this.configManager = new ConfigManager()
    this.conversationManager = new ConversationManager()
    this.toolManager = new ToolManager()
    this.aiEngine = new AIEngine(this.configManager)
    this.fileWatcher = new FileWatcher()

    this.toolManager.registerBuiltinTools()
    const pluginDir = path.join(app.getPath('userData'), 'tools')
    const discovery = await this.toolManager.discoverTools(pluginDir)
    if (discovery.errors.length > 0) {
      console.warn('[ToolManager] 插件加载告警:', discovery.errors)
    }
    console.log(`[ToolManager] 已加载工具 ${this.toolManager.count} 个（插件新增 ${discovery.loaded} 个）`)

    this.createMainWindow()
    this.createChatWindow()
    this.createLive2DWindow()
    this.createTray()
    this.registerGlobalShortcuts()
    this.registerIPCHandlers()
    this.startFileWatcher()
    this.startRandomTimer()

    app.on('before-quit', () => {
      this.isQuitting = true
    })

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit()
    })

    app.on('will-quit', () => {
      globalShortcut.unregisterAll()
      this.fileWatcher.stopAll()
      if (this.randomTimer) clearTimeout(this.randomTimer)
    })
  }

  private requestQuit() {
    this.isQuitting = true
    this.mainWindow?.destroy()
    this.chatWindow?.destroy()
    this.live2dWindow?.destroy()
    app.quit()
  }

  private createMainWindow() {
    this.mainWindow = new BrowserWindow({
      width: 900,
      height: 700,
      show: false,
      title: 'AI Bot - 设置',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    if (process.env.NODE_ENV === 'development') {
      this.mainWindow.loadURL('http://localhost:5173')
    } else {
      this.mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'))
    }

    this.mainWindow.on('close', (e) => {
      if (this.isQuitting) return
      e.preventDefault()
      this.mainWindow?.hide()
    })
  }

  private createChatWindow() {
    const config = this.configManager.getAll()
    this.chatWindow = new BrowserWindow({
      width: config.window.chatWidth,
      height: config.window.chatHeight,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: true,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    if (process.env.NODE_ENV === 'development') {
      this.chatWindow.loadURL('http://localhost:5173/#/chat')
    } else {
      this.chatWindow.loadFile(path.join(__dirname, '../../renderer/index.html'), { hash: 'chat' })
    }
  }

  private createLive2DWindow() {
    const config = this.configManager.getAll()
    this.live2dWindow = new BrowserWindow({
      width: config.window.live2dWidth,
      height: config.window.live2dHeight,
      show: true,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    this.live2dWindow.setIgnoreMouseEvents(true, { forward: true })

    if (process.env.NODE_ENV === 'development') {
      this.live2dWindow.loadURL('http://localhost:5173/#/live2d')
    } else {
      this.live2dWindow.loadFile(path.join(__dirname, '../../renderer/index.html'), { hash: 'live2d' })
    }
  }

  private createTray() {
    const iconPath = path.join(process.cwd(), 'build', 'icon.png')
    const icon = nativeImage.createFromPath(iconPath)
    this.tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
    this.tray.setToolTip('AI Bot')

    const contextMenu = Menu.buildFromTemplate([
      { label: '打开设置', click: () => this.mainWindow?.show() },
      { label: '显示/隐藏对话窗口', click: () => this.toggleChatWindow() },
      { label: '显示/隐藏 Live2D', click: () => this.toggleLive2DWindow() },
      { type: 'separator' },
      { label: '退出程序', click: () => this.requestQuit() },
    ])

    this.tray.setContextMenu(contextMenu)
    this.tray.on('double-click', () => this.mainWindow?.show())
  }

  private registerGlobalShortcuts() {
    const config = this.configManager.getAll()
    globalShortcut.register(config.hotkeys.toggleChat, () => {
      this.toggleChatWindow()
      const ctx: InvokeContext = { trigger: 'hotkey' }
      this.chatWindow?.webContents.send(IPC_CHANNELS.TRIGGER_INVOKE, ctx)
    })
    globalShortcut.register(config.hotkeys.toggleLive2D, () => this.toggleLive2DWindow())
  }

  private toggleChatWindow() {
    if (!this.chatWindow) return
    if (this.chatWindow.isVisible()) {
      this.chatWindow.hide()
    } else {
      this.chatWindow.show()
      this.chatWindow.focus()
    }
  }

  private toggleLive2DWindow() {
    if (!this.live2dWindow) return
    if (this.live2dWindow.isVisible()) {
      this.live2dWindow.hide()
    } else {
      this.live2dWindow.show()
    }
  }

  private registerIPCHandlers() {
    ipcMain.handle(IPC_CHANNELS.CONFIG_GET, (_e, key: string) => this.configManager.get(key))
    ipcMain.handle(IPC_CHANNELS.CONFIG_SET, (_e, key: string, value: unknown) => this.configManager.set(key, value))
    ipcMain.handle(IPC_CHANNELS.CONFIG_GET_ALL, () => this.configManager.getAll())

    ipcMain.handle(IPC_CHANNELS.CHAT_SEND, async (_e, messages, apiConfigId, model) => {
      return this.aiEngine.chat(messages, apiConfigId, model)
    })
    ipcMain.handle(IPC_CHANNELS.CHAT_ABORT, () => this.aiEngine.abort())
    ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY_LIST, () => this.conversationManager.list())
    ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY_GET, (_e, id: string) => this.conversationManager.get(id))
    ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY_CREATE, (_e, conversation) => this.conversationManager.create(conversation))
    ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY_SAVE, (_e, conversation) => this.conversationManager.save(conversation))
    ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY_DELETE, (_e, id: string) => this.conversationManager.delete(id))

    ipcMain.handle(IPC_CHANNELS.TOOL_EXECUTE, async (_e, name: string, args: Record<string, unknown>) => {
      return this.toolManager.execute(name, args)
    })
    ipcMain.handle(IPC_CHANNELS.TOOL_LIST, () => this.toolManager.getToolDefinitions())

    ipcMain.handle(IPC_CHANNELS.FILE_READ, async (_e, filePath: string) => this.toolManager.execute('file_read', { path: filePath }))
    ipcMain.handle(IPC_CHANNELS.FILE_WRITE, async (_e, filePath: string, content: string) => {
      return this.toolManager.execute('file_write', { path: filePath, content })
    })
    ipcMain.handle(IPC_CHANNELS.FILE_LIST, async (_e, folderPath: string) => this.toolManager.execute('file_list', { path: folderPath }))
    ipcMain.handle(IPC_CHANNELS.FILE_OPEN_IN_BROWSER, async (_e, filePath: string) => shell.openPath(filePath))

    ipcMain.handle(IPC_CHANNELS.LIVE2D_ACTION, (_e, action) => {
      this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_ACTION, action)
    })
    ipcMain.handle(IPC_CHANNELS.LIVE2D_LOAD_MODEL, (_e, modelPath: string) => {
      this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_LOAD_MODEL, modelPath)
    })

    ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_CHAT, () => this.toggleChatWindow())
    ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_LIVE2D, () => this.toggleLive2DWindow())
    ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
    ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, (e) => BrowserWindow.fromWebContents(e.sender)?.hide())

    ipcMain.handle(IPC_CHANNELS.DIALOG_SELECT_FOLDER, async () => {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      return result.canceled ? null : result.filePaths[0]
    })
    ipcMain.handle(IPC_CHANNELS.DIALOG_SELECT_FILE, async (_e, filters) => {
      const result = await dialog.showOpenDialog({ properties: ['openFile'], filters })
      return result.canceled ? null : result.filePaths[0]
    })
  }

  private startFileWatcher() {
    const config = this.configManager.getAll()
    for (const folder of config.watchFolders) {
      this.fileWatcher.watch(folder, (eventType, filePath) => {
        const data = { type: eventType, path: filePath }
        this.chatWindow?.webContents.send(IPC_CHANNELS.FILE_WATCH_EVENT, data)
        const ctx: InvokeContext = {
          trigger: 'file_change',
          fileChangeInfo: { type: eventType as 'add' | 'change' | 'unlink', filePath },
        }
        this.chatWindow?.webContents.send(IPC_CHANNELS.TRIGGER_INVOKE, ctx)
      })
    }
  }

  private startRandomTimer() {
    const config = this.configManager.getAll()
    const { min, max } = config.randomTimerRange
    const delay = (Math.random() * (max - min) + min) * 60 * 1000
    this.randomTimer = setTimeout(() => {
      const ctx: InvokeContext = { trigger: 'random_timer' }
      this.chatWindow?.webContents.send(IPC_CHANNELS.TRIGGER_INVOKE, ctx)
      if (this.chatWindow && !this.chatWindow.isVisible()) {
        this.chatWindow.show()
      }
      this.startRandomTimer()
    }, delay)
  }
}

const application = new Application()
application.init().catch(console.error)
