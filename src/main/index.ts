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
import fs from 'fs'
import { ConfigManager } from './config-manager'
import { ConversationManager } from './conversation-manager'
import { ToolManager } from './tools/tool-manager'
import { FileWatcher } from './file-watcher'
import { AIEngine } from './ai/ai-engine'
import { MemoryManager } from './ai/memory-manager'
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
  private memoryManager!: MemoryManager

  private randomTimer: NodeJS.Timeout | null = null
  private persistWindowTimer: NodeJS.Timeout | null = null
  private isQuitting = false

  private registerShortcutWithFallback(
    shortcut: string,
    fallback: string,
    onTrigger: () => void
  ): { applied: string; warnings: string[] } {
    const warnings: string[] = []
    if (globalShortcut.register(shortcut, onTrigger)) {
      return { applied: shortcut, warnings }
    }

    warnings.push(`快捷键 "${shortcut}" 注册失败，已回退到 "${fallback}"`)
    console.warn(`[Hotkey] 注册失败: ${shortcut}，回退到 ${fallback}`)
    if (shortcut !== fallback && globalShortcut.register(fallback, onTrigger)) {
      return { applied: fallback, warnings }
    }

    warnings.push(`回退快捷键 "${fallback}" 也注册失败`)
    console.warn(`[Hotkey] 回退注册也失败: ${fallback}`)
    return { applied: '', warnings }
  }

  async init() {
    await app.whenReady()
    app.setAppUserModelId('com.dice.aibot')

    this.configManager = new ConfigManager()
    this.conversationManager = new ConversationManager()
    this.toolManager = new ToolManager(() => this.configManager.getAll())
    this.aiEngine = new AIEngine(this.configManager)
    this.memoryManager = new MemoryManager()
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
      if (this.persistWindowTimer) clearTimeout(this.persistWindowTimer)
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
    const icon = this.resolveIconPath()
    const preload = this.resolvePreloadPath()
    this.mainWindow = new BrowserWindow({
      width: 900,
      height: 700,
      show: true,
      title: 'AI Bot - 设置',
      ...(icon ? { icon } : {}),
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
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
    const icon = this.resolveIconPath()
    const preload = this.resolvePreloadPath()
    this.chatWindow = new BrowserWindow({
      width: config.window.chatWidth,
      height: config.window.chatHeight,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: true,
      skipTaskbar: true,
      ...(icon ? { icon } : {}),
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    if (process.env.NODE_ENV === 'development') {
      this.chatWindow.loadURL('http://localhost:5173/#/chat')
    } else {
      this.chatWindow.loadFile(path.join(__dirname, '../../renderer/index.html'), { hash: 'chat' })
    }

    this.chatWindow.on('resize', () => this.schedulePersistWindowSize())
  }

  private createLive2DWindow() {
    const config = this.configManager.getAll()
    const hasModel = !!config.live2dModelPath
    const icon = this.resolveIconPath()
    const preload = this.resolvePreloadPath()
    this.live2dWindow = new BrowserWindow({
      width: config.window.live2dWidth,
      height: config.window.live2dHeight,
      show: hasModel,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      ...(icon ? { icon } : {}),
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: false,
        sandbox: false,
      },
    })

    this.live2dWindow.setIgnoreMouseEvents(false)

    if (process.env.NODE_ENV === 'development') {
      this.live2dWindow.loadURL('http://localhost:5173/#/live2d')
    } else {
      this.live2dWindow.loadFile(path.join(__dirname, '../../renderer/index.html'), { hash: 'live2d' })
    }

    this.live2dWindow.webContents.on('did-finish-load', () => {
      const modelPath = this.configManager.getAll().live2dModelPath
      if (modelPath) {
        this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_LOAD_MODEL, modelPath)
      }
    })

    this.live2dWindow.on('resize', () => this.schedulePersistWindowSize())
  }

  private createTray() {
    const icon = this.resolveNativeIcon()
    this.tray = new Tray(icon)
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

  private registerGlobalShortcuts(): { applied: { toggleChat: string; toggleLive2D: string }; warnings: string[] } {
    const config = this.configManager.getAll()
    globalShortcut.unregisterAll()

    const chatHotkey = config.hotkeys.toggleChat || 'CommandOrControl+Shift+A'
    const live2dHotkey = config.hotkeys.toggleLive2D || 'CommandOrControl+Shift+L'

    const chatHandler = () => {
      this.toggleChatWindow()
      const ctx: InvokeContext = { trigger: 'hotkey' }
      this.chatWindow?.webContents.send(IPC_CHANNELS.TRIGGER_INVOKE, ctx)
    }
    const live2dHandler = () => this.toggleLive2DWindow()

    const chatResult = this.registerShortcutWithFallback(chatHotkey, 'CommandOrControl+Shift+A', chatHandler)
    const live2dResult = this.registerShortcutWithFallback(
      live2dHotkey,
      'CommandOrControl+Shift+L',
      live2dHandler
    )

    const applied = {
      toggleChat: chatResult.applied || 'CommandOrControl+Shift+A',
      toggleLive2D: live2dResult.applied || 'CommandOrControl+Shift+L',
    }
    return { applied, warnings: [...chatResult.warnings, ...live2dResult.warnings] }
  }

  private toggleChatWindow() {
    if (!this.chatWindow) return
    if (this.chatWindow.isVisible()) {
      this.chatWindow.hide()
      this.live2dWindow?.setIgnoreMouseEvents(false)
    } else {
      this.chatWindow.show()
      this.chatWindow.focus()
      this.live2dWindow?.setIgnoreMouseEvents(true, { forward: true })
    }
  }

  private showChatWindow() {
    if (!this.chatWindow) return
    if (!this.chatWindow.isVisible()) {
      this.chatWindow.show()
    }
    this.chatWindow.focus()
    this.live2dWindow?.setIgnoreMouseEvents(true, { forward: true })
  }

  private toggleLive2DWindow() {
    if (!this.live2dWindow) return
    if (this.live2dWindow.isVisible()) {
      this.live2dWindow.hide()
    } else {
      this.live2dWindow.show()
    }
  }

  private restartFileWatcher() {
    this.fileWatcher.stopAll()
    this.startFileWatcher()
  }

  private restartRandomTimer() {
    if (this.randomTimer) {
      clearTimeout(this.randomTimer)
      this.randomTimer = null
    }
    this.startRandomTimer()
  }

  private schedulePersistWindowSize() {
    if (this.persistWindowTimer) {
      clearTimeout(this.persistWindowTimer)
    }
    this.persistWindowTimer = setTimeout(() => {
      const next = { ...this.configManager.getAll().window }
      if (this.chatWindow && !this.chatWindow.isDestroyed()) {
        const [chatWidth, chatHeight] = this.chatWindow.getSize()
        next.chatWidth = chatWidth
        next.chatHeight = chatHeight
      }
      if (this.live2dWindow && !this.live2dWindow.isDestroyed()) {
        const [live2dWidth, live2dHeight] = this.live2dWindow.getSize()
        next.live2dWidth = live2dWidth
        next.live2dHeight = live2dHeight
      }
      this.configManager.set('window', next)
    }, 300)
  }

  private registerIPCHandlers() {
    ipcMain.handle(IPC_CHANNELS.CONFIG_GET, (_e, key: string) => this.configManager.get(key))
    ipcMain.handle(IPC_CHANNELS.CONFIG_SET, (_e, key: string, value: unknown) => {
      this.configManager.set(key, value)
      let hotkeyResult:
        | { applied: { toggleChat: string; toggleLive2D: string }; warnings: string[] }
        | undefined
      if (key === 'live2dModelPath' && typeof value === 'string') {
        if (value) {
          this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_LOAD_MODEL, value)
          this.live2dWindow?.show()
        } else {
          this.live2dWindow?.hide()
        }
      }
      if (key === 'hotkeys') {
        hotkeyResult = this.registerGlobalShortcuts()
        this.configManager.set('hotkeys', hotkeyResult.applied)
      }
      if (key === 'watchFolders') {
        this.restartFileWatcher()
      }
      if (key === 'randomTimerRange') {
        this.restartRandomTimer()
      }
      if (key === 'window') {
        const windowConfig = this.configManager.getAll().window
        this.chatWindow?.setSize(windowConfig.chatWidth, windowConfig.chatHeight)
        this.live2dWindow?.setSize(windowConfig.live2dWidth, windowConfig.live2dHeight)
      }
      if (hotkeyResult) {
        return hotkeyResult
      }
      return { ok: true }
    })
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

    ipcMain.handle(IPC_CHANNELS.MEMORY_LIST, () => this.memoryManager.list())
    ipcMain.handle(IPC_CHANNELS.MEMORY_DELETE, (_e, id: string) => this.memoryManager.delete(id))
    ipcMain.handle(IPC_CHANNELS.MEMORY_CLEAR, () => this.memoryManager.clear())
    ipcMain.handle(IPC_CHANNELS.MEMORY_MERGE, (_e, ids: string[]) =>
      this.memoryManager.merge(ids, this.configManager.getAll().agentChain.memoryMaxItems)
    )

    ipcMain.handle(IPC_CHANNELS.TOOL_EXECUTE, async (_e, name: string, args: Record<string, unknown>) => {
      return this.toolManager.execute(name, args)
    })
    ipcMain.handle(IPC_CHANNELS.TOOL_LIST, () => this.toolManager.getToolDefinitions())

    ipcMain.handle(IPC_CHANNELS.FILE_READ, async (_e, filePath: string) =>
      this.toolManager.execute('file_read', { path: filePath })
    )
    ipcMain.handle(IPC_CHANNELS.FILE_WRITE, async (_e, filePath: string, content: string) =>
      this.toolManager.execute('file_write', { path: filePath, content })
    )
    ipcMain.handle(IPC_CHANNELS.FILE_LIST, async (_e, folderPath: string) =>
      this.toolManager.execute('file_list', { path: folderPath })
    )
    ipcMain.handle(IPC_CHANNELS.FILE_OPEN_IN_BROWSER, async (_e, filePath: string) => shell.openPath(filePath))

    ipcMain.handle(IPC_CHANNELS.LIVE2D_ACTION, (_e, action) => {
      this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_ACTION, action)
    })
    ipcMain.handle(IPC_CHANNELS.LIVE2D_LOAD_MODEL, (_e, modelPath: string) => {
      this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_LOAD_MODEL, modelPath)
    })
    ipcMain.handle(IPC_CHANNELS.LIVE2D_SHOW_REPLY, (_e, text: string) => {
      this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_SHOW_REPLY, text)
    })

    ipcMain.handle(IPC_CHANNELS.TRIGGER_INVOKE, (_e, ctx: InvokeContext) => {
      this.chatWindow?.webContents.send(IPC_CHANNELS.TRIGGER_INVOKE, ctx)
    })

    ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_CHAT, () => this.toggleChatWindow())
    ipcMain.handle(IPC_CHANNELS.WINDOW_SHOW_CHAT, () => this.showChatWindow())
    ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_LIVE2D, () => this.toggleLive2DWindow())
    ipcMain.handle(IPC_CHANNELS.WINDOW_OPEN_SETTINGS, () => {
      this.mainWindow?.show()
      this.mainWindow?.focus()
    })
    ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, (e) => {
      const window = BrowserWindow.fromWebContents(e.sender)
      if (window) {
        if (window === this.chatWindow || window === this.live2dWindow) {
          window.hide()
          if (window === this.chatWindow) {
            this.live2dWindow?.setIgnoreMouseEvents(false)
          }
          return
        }
        window.minimize()
      }
    })
    ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, (e) => {
      const window = BrowserWindow.fromWebContents(e.sender)
      if (window) {
        if (window === this.mainWindow) {
          window.hide() // 只有主窗口是隐藏
        } else if (window === this.chatWindow) {
          window.hide() // 聊天窗口也隐藏
          this.live2dWindow?.setIgnoreMouseEvents(false) // 恢复Live2D点击穿透
        } else {
          window.close() // 其他窗口关闭
        }
      }
    })

    ipcMain.handle(IPC_CHANNELS.DIALOG_SELECT_FOLDER, async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender) || this.mainWindow!
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
      })
      return result.canceled ? null : result.filePaths[0]
    })
    ipcMain.handle(IPC_CHANNELS.DIALOG_SELECT_FILE, async (e, filters) => {
      const win = BrowserWindow.fromWebContents(e.sender) || this.mainWindow!
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters,
      })
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

  private resolveIconPath(): string | null {
    const candidates = [
      path.join(process.cwd(), 'build', 'icon.png'),
      path.join(app.getAppPath(), 'build', 'icon.png'),
      path.join(process.resourcesPath, 'build', 'icon.png'),
      path.join(process.resourcesPath, 'icon.png'),
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) return p
    }
    return null
  }

  private resolvePreloadPath(): string {
    const candidates = [
      path.join(__dirname, '../preload/index.js'),
      path.join(app.getAppPath(), 'dist', 'main', 'preload', 'index.js'),
      path.join(process.resourcesPath, 'app.asar', 'dist', 'main', 'preload', 'index.js'),
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) return p
    }
    return candidates[0]
  }

  private resolveNativeIcon() {
    const iconPath = this.resolveIconPath()
    if (!iconPath) return nativeImage.createEmpty()
    const icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) return nativeImage.createEmpty()
    return icon.resize({ width: 16, height: 16 })
  }
}

const application = new Application()
application.init().catch(console.error)
