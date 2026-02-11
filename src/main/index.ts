import { app, BrowserWindow, globalShortcut, ipcMain, dialog, shell, Tray, Menu, nativeImage } from 'electron'
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

  async init() {
    await app.whenReady()

    // 初始化管理器
    this.configManager = new ConfigManager()
    this.conversationManager = new ConversationManager()
    this.toolManager = new ToolManager()
    this.aiEngine = new AIEngine(this.configManager)
    this.fileWatcher = new FileWatcher()

    // 注册内置工具
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

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit()
    })

    app.on('will-quit', () => {
      globalShortcut.unregisterAll()
      this.fileWatcher.stopAll()
      if (this.randomTimer) clearTimeout(this.randomTimer)
    })
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
      }
    })

    if (process.env.NODE_ENV === 'development') {
      this.mainWindow.loadURL('http://localhost:5173')
    } else {
      this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }

    this.mainWindow.on('close', (e) => {
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
      }
    })

    if (process.env.NODE_ENV === 'development') {
      this.chatWindow.loadURL('http://localhost:5173/#/chat')
    } else {
      this.chatWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: 'chat' })
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
      }
    })

    // 允许点击穿透到桌面（除了模型区域）
    this.live2dWindow.setIgnoreMouseEvents(true, { forward: true })

    if (process.env.NODE_ENV === 'development') {
      this.live2dWindow.loadURL('http://localhost:5173/#/live2d')
    } else {
      this.live2dWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: 'live2d' })
    }
  }

  private createTray() {
    const icon = nativeImage.createEmpty()
    this.tray = new Tray(icon)
    this.tray.setToolTip('AI Bot')

    const contextMenu = Menu.buildFromTemplate([
      { label: '打开设置', click: () => this.mainWindow?.show() },
      { label: '显示/隐藏对话', click: () => this.toggleChatWindow() },
      { label: '显示/隐藏形象', click: () => this.toggleLive2DWindow() },
      { type: 'separator' },
      { label: '退出', click: () => { app.quit() } }
    ])
    this.tray.setContextMenu(contextMenu)
    this.tray.on('double-click', () => this.mainWindow?.show())
  }

  private registerGlobalShortcuts() {
    const config = this.configManager.getAll()

    globalShortcut.register(config.hotkeys.toggleChat, () => {
      this.toggleChatWindow()
      // 发送唤起事件到渲染进程
      const ctx: InvokeContext = { trigger: 'hotkey' }
      this.chatWindow?.webContents.send(IPC_CHANNELS.TRIGGER_INVOKE, ctx)
    })

    globalShortcut.register(config.hotkeys.toggleLive2D, () => {
      this.toggleLive2DWindow()
    })
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
    // --- Config ---
    ipcMain.handle(IPC_CHANNELS.CONFIG_GET, (_e, key: string) => {
      return this.configManager.get(key)
    })
    ipcMain.handle(IPC_CHANNELS.CONFIG_SET, (_e, key: string, value: unknown) => {
      this.configManager.set(key, value)
    })
    ipcMain.handle(IPC_CHANNELS.CONFIG_GET_ALL, () => {
      return this.configManager.getAll()
    })

    // --- Chat ---
    ipcMain.handle(IPC_CHANNELS.CHAT_SEND, async (_e, messages, apiConfigId, model) => {
      return this.aiEngine.chat(messages, apiConfigId, model)
    })
    ipcMain.handle(IPC_CHANNELS.CHAT_ABORT, () => {
      this.aiEngine.abort()
    })
    ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY_LIST, () => {
      return this.conversationManager.list()
    })
    ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY_GET, (_e, id: string) => {
      return this.conversationManager.get(id)
    })
    ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY_CREATE, (_e, conversation) => {
      return this.conversationManager.create(conversation)
    })
    ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY_SAVE, (_e, conversation) => {
      this.conversationManager.save(conversation)
    })
    ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY_DELETE, (_e, id: string) => {
      this.conversationManager.delete(id)
    })

    // --- Tools ---
    ipcMain.handle(IPC_CHANNELS.TOOL_EXECUTE, async (_e, name: string, args: Record<string, unknown>) => {
      return this.toolManager.execute(name, args)
    })
    ipcMain.handle(IPC_CHANNELS.TOOL_LIST, () => {
      return this.toolManager.getToolDefinitions()
    })

    // --- File Operations ---
    ipcMain.handle(IPC_CHANNELS.FILE_READ, async (_e, filePath: string) => {
      return this.toolManager.execute('file_read', { path: filePath })
    })
    ipcMain.handle(IPC_CHANNELS.FILE_WRITE, async (_e, filePath: string, content: string) => {
      return this.toolManager.execute('file_write', { path: filePath, content })
    })
    ipcMain.handle(IPC_CHANNELS.FILE_LIST, async (_e, folderPath: string) => {
      return this.toolManager.execute('file_list', { path: folderPath })
    })
    ipcMain.handle(IPC_CHANNELS.FILE_OPEN_IN_BROWSER, async (_e, filePath: string) => {
      return shell.openPath(filePath)
    })

    // --- Live2D ---
    ipcMain.handle(IPC_CHANNELS.LIVE2D_ACTION, (_e, action) => {
      this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_ACTION, action)
    })
    ipcMain.handle(IPC_CHANNELS.LIVE2D_LOAD_MODEL, (_e, modelPath: string) => {
      this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_LOAD_MODEL, modelPath)
    })

    // --- Window ---
    ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_CHAT, () => this.toggleChatWindow())
    ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_LIVE2D, () => this.toggleLive2DWindow())
    ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, (e) => {
      BrowserWindow.fromWebContents(e.sender)?.minimize()
    })
    ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, (e) => {
      BrowserWindow.fromWebContents(e.sender)?.hide()
    })

    // --- Dialog ---
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
        // 通知渲染进程
        const data = { type: eventType, path: filePath }
        this.chatWindow?.webContents.send(IPC_CHANNELS.FILE_WATCH_EVENT, data)

        // 触发 AI 对话
        const ctx: InvokeContext = {
          trigger: 'file_change',
          fileChangeInfo: { type: eventType as 'add' | 'change' | 'unlink', filePath }
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
      // 重新启动定时器
      this.startRandomTimer()
    }, delay)
  }
}

const application = new Application()
application.init().catch(console.error)
