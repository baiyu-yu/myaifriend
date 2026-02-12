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
import { AppLogEntry, IPC_CHANNELS, InvokeContext } from '../common/types'

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
  private runtimeLogs: AppLogEntry[] = []
  private storageMetaPath = ''

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

  private normalizeHotkey(input: string, fallback: string): string {
    const raw = (input || '').trim()
    if (!raw) return fallback
    return raw
      .replace(/\s+/g, '')
      .replace(/\b(ctrl|control)\b/gi, 'CommandOrControl')
      .replace(/\bcmd\b/gi, 'Command')
      .replace(/\boption\b/gi, 'Alt')
  }

  private toIPCData<T>(value: T): T {
    try {
      return structuredClone(value)
    } catch {
      return JSON.parse(
        JSON.stringify(value, (_key, item) => {
          if (typeof item === 'bigint') return Number(item)
          if (Buffer.isBuffer(item)) return item.toString('utf8')
          if (typeof item === 'function' || typeof item === 'symbol') return undefined
          return item
        })
      ) as T
    }
  }

  private addRuntimeLog(
    level: 'info' | 'warn' | 'error',
    message: string,
    source = 'main'
  ): AppLogEntry {
    const entry: AppLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      level,
      source,
      message: String(message || ''),
    }
    this.runtimeLogs.unshift(entry)
    if (this.runtimeLogs.length > 500) {
      this.runtimeLogs = this.runtimeLogs.slice(0, 500)
    }
    return entry
  }

  private async discoverPluginTools() {
    const pluginDir = path.join(this.configManager.getStorageDir(), 'tools')
    const discovery = await this.toolManager.discoverTools(pluginDir)
    if (discovery.errors.length > 0) {
      console.warn('[ToolManager] 插件加载告警:', discovery.errors)
      this.addRuntimeLog('warn', `工具插件加载告警: ${discovery.errors.join(' | ')}`, 'tool-manager')
    }
    console.log(`[ToolManager] 已加载工具 ${this.toolManager.count} 个（插件新增 ${discovery.loaded} 个）`)
    this.addRuntimeLog('info', `工具已加载 ${this.toolManager.count} 个（插件新增 ${discovery.loaded} 个）`, 'tool-manager')
  }

  async init() {
    await app.whenReady()
    app.setAppUserModelId('com.dice.aibot')
    Menu.setApplicationMenu(null)
    this.storageMetaPath = path.join(app.getPath('userData'), 'storage-location.json')
    const storageDir = this.resolveStorageDir()
    fs.mkdirSync(storageDir, { recursive: true })

    this.configManager = new ConfigManager(storageDir)
    this.conversationManager = new ConversationManager(storageDir)
    this.toolManager = new ToolManager(() => this.configManager.getAll())
    this.aiEngine = new AIEngine(this.configManager)
    this.memoryManager = new MemoryManager(storageDir)
    this.fileWatcher = new FileWatcher()

    this.toolManager.registerBuiltinTools({
      memoryManager: this.memoryManager,
      conversationManager: this.conversationManager,
    })

    this.createMainWindow()
    this.createChatWindow()
    this.createLive2DWindow()
    this.createTray()
    this.registerGlobalShortcuts()
    this.registerIPCHandlers()
    this.startFileWatcher()
    this.startRandomTimer()
    void this.discoverPluginTools().catch((error) => console.error('[ToolManager] 插件加载失败:', error))

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

  private resolveStorageDir(): string {
    const fallback = app.getPath('userData')
    try {
      if (!this.storageMetaPath || !fs.existsSync(this.storageMetaPath)) return fallback
      const raw = fs.readFileSync(this.storageMetaPath, 'utf-8')
      const parsed = JSON.parse(raw)
      const next = String(parsed?.dataDir || '').trim()
      return next || fallback
    } catch {
      return fallback
    }
  }

  private saveStorageDir(dirPath: string) {
    fs.writeFileSync(this.storageMetaPath, JSON.stringify({ dataDir: dirPath }, null, 2), 'utf-8')
  }

  private migrateStorageFiles(fromDir: string, toDir: string) {
    if (!fromDir || !toDir || fromDir === toDir) return
    fs.mkdirSync(toDir, { recursive: true })
    const targets = ['aibot-config.json', 'aibot-conversations.json', 'aibot-memory.json']
    for (const name of targets) {
      const fromPath = path.join(fromDir, name)
      const toPath = path.join(toDir, name)
      if (!fs.existsSync(fromPath) || fs.existsSync(toPath)) continue
      fs.copyFileSync(fromPath, toPath)
    }
  }

  private openMainRoute(route: 'cover' | 'settings') {
    if (!this.mainWindow) return
    const hash = route === 'settings' ? '' : 'cover'
    if (process.env.NODE_ENV === 'development') {
      const target = hash ? `http://localhost:5173/#/${hash}` : 'http://localhost:5173/#/'
      this.mainWindow.loadURL(target)
    } else {
      this.mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'), {
        ...(hash ? { hash } : {}),
      })
    }
    this.mainWindow.show()
    this.mainWindow.focus()
  }

  private createMainWindow() {
    const icon = this.resolveIconPath()
    const preload = this.resolvePreloadPath()
    this.mainWindow = new BrowserWindow({
      width: 900,
      height: 700,
      show: true,
      title: 'AI Bot - 设置',
      autoHideMenuBar: true,
      ...(icon ? { icon } : {}),
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    if (process.env.NODE_ENV === 'development') {
      this.mainWindow.loadURL('http://localhost:5173/#/cover')
    } else {
      this.mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'), { hash: 'cover' })
    }
    this.mainWindow.setMenuBarVisibility(false)

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
      autoHideMenuBar: true,
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
    const icon = this.resolveIconPath()
    const preload = this.resolvePreloadPath()
    this.live2dWindow = new BrowserWindow({
      width: config.window.live2dWidth,
      height: config.window.live2dHeight,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      autoHideMenuBar: true,
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
      { label: '打开设置', click: () => this.openMainRoute('settings') },
      { label: '显示/隐藏对话窗口', click: () => this.toggleChatWindow() },
      { label: '显示/隐藏 Live2D', click: () => this.toggleLive2DWindow() },
      { type: 'separator' },
      { label: '退出程序', click: () => this.requestQuit() },
    ])

    this.tray.setContextMenu(contextMenu)
    this.tray.on('double-click', () => this.openMainRoute('settings'))
  }

  private registerGlobalShortcuts(): { applied: { toggleChat: string; toggleLive2D: string }; warnings: string[] } {
    const config = this.configManager.getAll()
    globalShortcut.unregisterAll()

    const chatHotkey = this.normalizeHotkey(config.hotkeys.toggleChat, 'CommandOrControl+Shift+A')
    const live2dHotkey = this.normalizeHotkey(config.hotkeys.toggleLive2D, 'CommandOrControl+Shift+L')

    const chatHandler = () => {
      this.toggleChatWindow()
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

  private showLive2DWindow() {
    if (!this.live2dWindow) return
    if (!this.live2dWindow.isVisible()) {
      this.live2dWindow.show()
    }
    this.live2dWindow.focus()
    this.live2dWindow.setIgnoreMouseEvents(false)
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

  private isLikelyLive2DModelFile(filePath: string): boolean {
    const lower = path.basename(filePath).toLowerCase()
    return lower.endsWith('.model3.json') || lower.endsWith('.model.json')
  }

  private async findLive2DModelInFolder(folderPath: string, depth = 0): Promise<string | null> {
    if (depth > 3) return null
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
    const files = entries.filter((e) => e.isFile()).map((e) => path.join(folderPath, e.name))
    const model3 = files.find((f) => path.basename(f).toLowerCase().endsWith('.model3.json'))
    if (model3) return model3
    const model2 = files.find((f) => path.basename(f).toLowerCase().endsWith('.model.json'))
    if (model2) return model2
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const hit = await this.findLive2DModelInFolder(path.join(folderPath, entry.name), depth + 1)
      if (hit) return hit
    }
    return null
  }

  private async resolveLive2DModelPath(inputPath: string): Promise<string> {
    const normalized = inputPath.trim()
    if (!normalized) return ''
    if (!fs.existsSync(normalized)) {
      throw new Error('路径不存在')
    }
    const stat = await fs.promises.stat(normalized)
    if (stat.isFile()) {
      if (!this.isLikelyLive2DModelFile(normalized)) {
        throw new Error('请选择 .model3.json 或 .model.json 模型文件')
      }
      return normalized
    }
    if (stat.isDirectory()) {
      const modelPath = await this.findLive2DModelInFolder(normalized)
      if (!modelPath) {
        throw new Error('所选文件夹中未找到 Live2D 模型入口（.model3.json/.model.json）')
      }
      return modelPath
    }
    throw new Error('无效的模型路径')
  }

  private async loadLive2DActionMap(modelPath: string): Promise<{
    expression: Record<string, string>
    motion: Record<string, string>
  }> {
    try {
      const raw = await fs.promises.readFile(modelPath, 'utf-8')
      const json = JSON.parse(raw)
      const expression: Record<string, string> = {}
      const motion: Record<string, string> = {}
      const pickNameFromFile = (filePath: unknown): string => {
        const file = String(filePath || '').trim()
        if (!file) return ''
        const base = path.basename(file)
        return base
          .replace(/\.motion3\.json$/i, '')
          .replace(/\.exp3\.json$/i, '')
          .replace(/\.mtn$/i, '')
          .replace(/\.json$/i, '')
      }

      const expressionsV3 = json?.FileReferences?.Expressions
      const expressionsV2 = json?.expressions
      const expressionList = Array.isArray(expressionsV3) ? expressionsV3 : Array.isArray(expressionsV2) ? expressionsV2 : []
      for (const item of expressionList) {
        const name = String(item?.Name || item?.name || '').trim() || pickNameFromFile(item?.File || item?.file)
        if (name) expression[name] = name
      }

      const motionsV3 = json?.FileReferences?.Motions
      const motionsV2 = json?.motions
      const motionObj =
        motionsV3 && typeof motionsV3 === 'object' ? motionsV3 : motionsV2 && typeof motionsV2 === 'object' ? motionsV2 : {}
      for (const key of Object.keys(motionObj)) {
        const groupName = String(key || '').trim()
        if (groupName) motion[groupName] = groupName
        const items = Array.isArray(motionObj[key]) ? motionObj[key] : []
        for (const item of items) {
          const motionName = pickNameFromFile(item?.File || item?.file)
          if (motionName) motion[motionName] = motionName
        }
      }

      return { expression, motion }
    } catch {
      return { expression: {}, motion: {} }
    }
  }

  private toDataUrlByPath(filePath: string): string | null {
    try {
      if (!fs.existsSync(filePath)) return null
      const ext = path.extname(filePath).toLowerCase()
      const mime =
        ext === '.png' ? 'image/png' : ext === '.ico' ? 'image/x-icon' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ''
      if (!mime) return null
      const content = fs.readFileSync(filePath).toString('base64')
      return `data:${mime};base64,${content}`
    } catch {
      return null
    }
  }

  private registerIPCHandlers() {
    ipcMain.handle(IPC_CHANNELS.CONFIG_GET, (_e, key: string) => this.configManager.get(key))
    ipcMain.handle(IPC_CHANNELS.CONFIG_SET, async (_e, key: string, value: unknown) => {
      let nextValue: unknown = value
      if (key === 'live2dModelPath' && typeof value === 'string') {
        try {
          nextValue = await this.resolveLive2DModelPath(value)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.addRuntimeLog('error', `Live2D 模型路径解析失败: ${value} | ${message}`, 'live2d')
          throw error
        }
        if (nextValue) {
          const parsed = await this.loadLive2DActionMap(String(nextValue))
          const current = this.configManager.getAll().live2dActionMap
          const merged = {
            expression: { ...parsed.expression, ...current.expression },
            motion: { ...parsed.motion, ...current.motion },
          }
          this.configManager.set('live2dActionMap', merged)
          this.addRuntimeLog(
            'info',
            `Live2D 映射已自动读取: expression ${Object.keys(parsed.expression).length} 项, motion ${Object.keys(parsed.motion).length} 项`,
            'live2d'
          )
        }
      }
      this.configManager.set(key, nextValue)
      let hotkeyResult:
        | { applied: { toggleChat: string; toggleLive2D: string }; warnings: string[] }
        | undefined
      if (key === 'live2dModelPath' && typeof value === 'string') {
        const modelPath = String(nextValue || '')
        if (modelPath) {
          this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_LOAD_MODEL, modelPath)
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
      const tools = this.toolManager.getToolDefinitions().filter((tool) => tool.enabled !== false)
      return this.toIPCData(await this.aiEngine.chat(messages, apiConfigId, model, 'premier', tools))
    })
    ipcMain.handle(IPC_CHANNELS.CHAT_ABORT, () => this.aiEngine.abort())
    ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY_LIST, () => this.toIPCData(this.conversationManager.list()))
    ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY_GET, (_e, id: string) => this.toIPCData(this.conversationManager.get(id)))
    ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY_CREATE, (_e, conversation) =>
      this.toIPCData(this.conversationManager.create(conversation))
    )
    ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY_SAVE, (_e, conversation) =>
      this.toIPCData(this.conversationManager.save(conversation))
    )
    ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY_DELETE, (_e, id: string) => this.conversationManager.delete(id))

    ipcMain.handle(IPC_CHANNELS.MEMORY_LIST, () => this.toIPCData(this.memoryManager.list()))
    ipcMain.handle(IPC_CHANNELS.MEMORY_DELETE, (_e, id: string) => this.memoryManager.delete(id))
    ipcMain.handle(IPC_CHANNELS.MEMORY_CLEAR, () => this.memoryManager.clear())
    ipcMain.handle(IPC_CHANNELS.MEMORY_MERGE, (_e, ids: string[]) =>
      this.memoryManager.merge(ids, this.configManager.getAll().agentChain.memoryMaxItems)
    )

    ipcMain.handle(IPC_CHANNELS.TOOL_EXECUTE, async (_e, name: string, args: Record<string, unknown>) =>
      this.toIPCData(await this.toolManager.execute(name, args))
    )
    ipcMain.handle(IPC_CHANNELS.TOOL_LIST, () => this.toIPCData(this.toolManager.getToolDefinitions()))

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
    ipcMain.handle(IPC_CHANNELS.WINDOW_SHOW_LIVE2D, () => this.showLive2DWindow())
    ipcMain.handle(IPC_CHANNELS.WINDOW_OPEN_SETTINGS, () => {
      this.openMainRoute('settings')
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
    ipcMain.handle(IPC_CHANNELS.DIALOG_SELECT_PATH, async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender) || this.mainWindow!
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile', 'openDirectory'],
        filters: [{ name: 'Live2D Model JSON', extensions: ['json'] }],
      })
      return result.canceled ? null : result.filePaths[0]
    })

    ipcMain.handle(IPC_CHANNELS.APP_GET_META, () => {
      const iconPath = this.resolveIconPath()
      const iconDataUrl = iconPath ? this.toDataUrlByPath(iconPath) : null
      return { name: 'AI Bot', iconDataUrl }
    })
    ipcMain.handle(IPC_CHANNELS.APP_LOG_LIST, () => this.toIPCData(this.runtimeLogs))
    ipcMain.handle(IPC_CHANNELS.APP_LOG_CLEAR, () => {
      this.runtimeLogs = []
      return { ok: true }
    })
    ipcMain.handle(
      IPC_CHANNELS.APP_LOG_ADD,
      (_e, level: 'info' | 'warn' | 'error', message: string, source?: string) =>
        this.addRuntimeLog(level, message, source || 'renderer')
    )
    ipcMain.handle(IPC_CHANNELS.APP_STORAGE_INFO, () => ({
      currentDir: this.configManager.getStorageDir(),
    }))
    ipcMain.handle(IPC_CHANNELS.APP_STORAGE_SET, (_e, storageDir: string) => {
      const nextDir = String(storageDir || '').trim()
      if (!nextDir) {
        throw new Error('存储目录不能为空')
      }
      fs.mkdirSync(nextDir, { recursive: true })
      const previousDir = this.configManager.getStorageDir()
      this.migrateStorageFiles(previousDir, nextDir)
      this.saveStorageDir(nextDir)
      this.addRuntimeLog('info', `数据存储目录已改为: ${nextDir}，应用将重启`, 'storage')
      this.isQuitting = true
      app.relaunch()
      this.requestQuit()
      return { ok: true, restarting: true }
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
    console.warn('[Preload] 未找到匹配文件，回退默认路径:', candidates[0])
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
