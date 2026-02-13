import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  dialog,
  shell,
  screen,
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
import { AppLogEntry, IPC_CHANNELS, InvokeContext, Live2DActionMap } from '../common/types'

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
  private dragSessions = new Map<number, { win: BrowserWindow; startX: number; startY: number; winX: number; winY: number }>()
  private mousePassthroughSessions = new Map<number, boolean>()
  private resizeSessions = new Map<
    number,
    {
      win: BrowserWindow
      edge: 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
      startX: number
      startY: number
      bounds: Electron.Rectangle
      minWidth: number
      minHeight: number
    }
  >()

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

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      const stackTop = error.stack?.split('\n').slice(0, 3).join(' > ')
      return stackTop ? `${error.message} | ${stackTop}` : error.message
    }
    return String(error)
  }

  private summarizeInvokeContext(ctx: InvokeContext): string {
    if (ctx.trigger === 'file_change' && ctx.fileChangeInfo) {
      return `${ctx.trigger} | ${ctx.fileChangeInfo.type} | ${ctx.fileChangeInfo.filePath}`
    }
    return ctx.trigger
  }

  private dispatchTrigger(ctx: InvokeContext, source = 'trigger') {
    this.addRuntimeLog('info', `AI 触发请求: ${this.summarizeInvokeContext(ctx)}`, source)
    this.chatWindow?.webContents.send(IPC_CHANNELS.TRIGGER_INVOKE, ctx)
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

  private syncLive2DWindowBounds(reason: string) {
    if (!this.live2dWindow || this.live2dWindow.isDestroyed()) return
    const bounds = screen.getPrimaryDisplay().bounds
    this.live2dWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    })
    this.live2dWindow.setMinimumSize(bounds.width, bounds.height)
    this.live2dWindow.setMaximumSize(bounds.width, bounds.height)
    if (reason !== 'init') {
      this.addRuntimeLog('info', `Live2D 窗口已固定全屏: reason=${reason}, size=${bounds.width}x${bounds.height}`, 'live2d')
    }
  }

  private createLive2DWindow() {
    const icon = this.resolveIconPath()
    const preload = this.resolvePreloadPath()
    const bounds = screen.getPrimaryDisplay().bounds
    this.live2dWindow = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
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

    this.syncLive2DWindowBounds('init')
    this.live2dWindow.setIgnoreMouseEvents(true, { forward: true })
    const syncBounds = () => this.syncLive2DWindowBounds('display-metrics-changed')
    screen.on('display-added', syncBounds)
    screen.on('display-removed', syncBounds)
    screen.on('display-metrics-changed', syncBounds)

    if (process.env.NODE_ENV === 'development') {
      this.live2dWindow.loadURL('http://localhost:5173/#/live2d')
    } else {
      this.live2dWindow.loadFile(path.join(__dirname, '../../renderer/index.html'), { hash: 'live2d' })
    }

    this.live2dWindow.webContents.on('did-finish-load', () => {
      const config = this.configManager.getAll()
      const modelPath = config.live2dModelPath
      this.addRuntimeLog(
        'info',
        `Live2D 窗口完成加载: hasModel=${Boolean(modelPath)} visible=${this.live2dWindow?.isVisible()}`,
        'live2d'
      )
      this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_BEHAVIOR_UPDATE, {
        ...config.live2dBehavior,
      })
      this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_CONTROLS_UPDATE, {
        ...config.live2dControls,
      })
      if (modelPath) {
        this.addRuntimeLog('info', `Live2D 窗口初始化下发模型: ${modelPath}`, 'live2d')
        this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_LOAD_MODEL, modelPath)
      }
    })
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
    } else {
      this.chatWindow.show()
      this.chatWindow.focus()
    }
  }

  private showChatWindow() {
    if (!this.chatWindow) return
    if (!this.chatWindow.isVisible()) {
      this.chatWindow.show()
    }
    this.chatWindow.focus()
  }

  private toggleLive2DWindow() {
    if (!this.live2dWindow) return
    if (this.live2dWindow.isVisible()) {
      this.live2dWindow.hide()
    } else {
      this.syncLive2DWindowBounds('toggle-show')
      this.live2dWindow.show()
      this.live2dWindow.setIgnoreMouseEvents(true, { forward: true })
    }
  }

  private showLive2DWindow() {
    if (!this.live2dWindow) return
    if (!this.live2dWindow.isVisible()) {
      this.live2dWindow.show()
    }
    this.syncLive2DWindowBounds('show')
    this.live2dWindow.setIgnoreMouseEvents(true, { forward: true })
  }

  private beginWindowDrag(sender: Electron.WebContents, x: number, y: number) {
    const win = BrowserWindow.fromWebContents(sender)
    if (!win || win.isDestroyed()) return { ok: false }
    if (win === this.live2dWindow) return { ok: false, reason: 'live2d-fixed-fullscreen' }
    this.mousePassthroughSessions.set(sender.id, false)
    win.setIgnoreMouseEvents(false)
    const [winX, winY] = win.getPosition()
    this.dragSessions.set(sender.id, { win, startX: x, startY: y, winX, winY })
    return { ok: true }
  }

  private updateWindowDrag(sender: Electron.WebContents, x: number, y: number) {
    const session = this.dragSessions.get(sender.id)
    if (!session) return { ok: false }
    if (session.win.isDestroyed()) {
      this.dragSessions.delete(sender.id)
      return { ok: false }
    }
    const nextX = Math.round(session.winX + (x - session.startX))
    const nextY = Math.round(session.winY + (y - session.startY))
    session.win.setPosition(nextX, nextY)
    return { ok: true }
  }

  private endWindowDrag(sender: Electron.WebContents) {
    const had = this.dragSessions.delete(sender.id)
    return { ok: had }
  }

  private setWindowMousePassthrough(sender: Electron.WebContents, enabled: boolean) {
    const win = BrowserWindow.fromWebContents(sender)
    if (!win || win.isDestroyed()) return { ok: false }
    const next = Boolean(enabled)
    const prev = this.mousePassthroughSessions.get(sender.id)
    if (prev === next) return { ok: true }
    this.mousePassthroughSessions.set(sender.id, next)
    win.setIgnoreMouseEvents(next, { forward: next })
    return { ok: true }
  }

  private getWindowMinSize(win: BrowserWindow): { minWidth: number; minHeight: number } {
    if (win === this.chatWindow) return { minWidth: 260, minHeight: 240 }
    if (win === this.live2dWindow) return { minWidth: 180, minHeight: 180 }
    return { minWidth: 160, minHeight: 120 }
  }

  private beginWindowResize(
    sender: Electron.WebContents,
    edge: 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
    x: number,
    y: number
  ) {
    const win = BrowserWindow.fromWebContents(sender)
    if (!win || win.isDestroyed()) return { ok: false }
    if (win === this.live2dWindow) return { ok: false, reason: 'live2d-fixed-fullscreen' }
    this.mousePassthroughSessions.set(sender.id, false)
    win.setIgnoreMouseEvents(false)
    const bounds = win.getBounds()
    const { minWidth, minHeight } = this.getWindowMinSize(win)
    this.resizeSessions.set(sender.id, { win, edge, startX: x, startY: y, bounds, minWidth, minHeight })
    return { ok: true }
  }

  private updateWindowResize(sender: Electron.WebContents, x: number, y: number) {
    const session = this.resizeSessions.get(sender.id)
    if (!session) return { ok: false }
    if (session.win.isDestroyed()) {
      this.resizeSessions.delete(sender.id)
      return { ok: false }
    }

    const dx = x - session.startX
    const dy = y - session.startY
    let { x: nextX, y: nextY, width: nextWidth, height: nextHeight } = session.bounds
    const { edge, minWidth, minHeight } = session
    const useLeft = edge.includes('left')
    const useRight = edge.includes('right')
    const useTop = edge.includes('top')
    const useBottom = edge.includes('bottom')

    if (useRight) {
      nextWidth = Math.max(minWidth, session.bounds.width + dx)
    }
    if (useBottom) {
      nextHeight = Math.max(minHeight, session.bounds.height + dy)
    }
    if (useLeft) {
      const candidateWidth = session.bounds.width - dx
      nextWidth = Math.max(minWidth, candidateWidth)
      nextX = session.bounds.x + (session.bounds.width - nextWidth)
    }
    if (useTop) {
      const candidateHeight = session.bounds.height - dy
      nextHeight = Math.max(minHeight, candidateHeight)
      nextY = session.bounds.y + (session.bounds.height - nextHeight)
    }

    session.win.setBounds({
      x: Math.round(nextX),
      y: Math.round(nextY),
      width: Math.round(nextWidth),
      height: Math.round(nextHeight),
    })
    return { ok: true }
  }

  private endWindowResize(sender: Electron.WebContents) {
    const session = this.resizeSessions.get(sender.id)
    const had = this.resizeSessions.delete(sender.id)
    if (session?.win && !session.win.isDestroyed()) {
      this.schedulePersistWindowSize()
    }
    return { ok: had }
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
      this.configManager.set('window', next)
    }, 300)
  }

  private isLikelyLive2DModelFile(filePath: string): boolean {
    const lower = path.basename(filePath).toLowerCase()
    return (
      lower.endsWith('.model3.json') ||
      lower.endsWith('.model.json') ||
      lower.endsWith('.vtube.json') ||
      lower.endsWith('.prprl2d.json')
    )
  }

  private normalizeModelKey(modelPath: string): string {
    return path.normalize(String(modelPath || '').trim())
  }

  private sanitizeLive2DActionMap(input: unknown): Live2DActionMap {
    const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
    const toRecord = (value: unknown): Record<string, string> => {
      if (!value || typeof value !== 'object') return {}
      const result: Record<string, string> = {}
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        const k = String(key || '').trim()
        const v = String(val || '').trim()
        if (k && v) result[k] = v
      }
      return result
    }
    return {
      expression: toRecord(source.expression),
      motion: toRecord(source.motion),
    }
  }

  private mergeLive2DActionMaps(base: Live2DActionMap, override: Live2DActionMap): Live2DActionMap {
    return {
      expression: { ...(base.expression || {}), ...(override.expression || {}) },
      motion: { ...(base.motion || {}), ...(override.motion || {}) },
    }
  }

  private upsertLive2DModelRecord(modelPath: string) {
    const config = this.configManager.getAll()
    const normalized = this.normalizeModelKey(modelPath)
    const now = Date.now()
    const next = (config.live2dModels || [])
      .filter((item) => this.normalizeModelKey(item.path) !== normalized)
      .map((item) => ({ ...item }))

    next.unshift({
      path: modelPath,
      label: path.basename(modelPath),
      lastUsedAt: now,
    })

    this.configManager.set('live2dModels', next.slice(0, 30))
  }

  private isModelEntryFile(filePath: string): boolean {
    const lower = path.basename(filePath).toLowerCase()
    return lower.endsWith('.model3.json') || lower.endsWith('.model.json')
  }

  private async findLive2DModelInFolder(folderPath: string, depth = 0): Promise<string | null> {
    if (depth > 3) return null
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
    } catch (error) {
      this.addRuntimeLog(
        'warn',
        `Live2D 目录扫描失败: ${folderPath} | ${this.describeError(error)}`,
        'live2d'
      )
      return null
    }
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

  private async resolveCompanionModelPath(metaPath: string): Promise<string | null> {
    const folder = path.dirname(metaPath)
    const basenameLower = path.basename(metaPath).toLowerCase()

    try {
      const raw = await fs.promises.readFile(metaPath, 'utf-8')
      const json = JSON.parse(raw)
      const refs = json?.FileReferences || json?.fileReferences || {}
      const candidates: string[] = []
      const modelRef = String(refs?.Model || refs?.model || '').trim()
      if (modelRef) candidates.push(path.resolve(folder, modelRef))
      if (basenameLower.endsWith('.vtube.json') || basenameLower.endsWith('.prprl2d.json')) {
        const stem = path.basename(metaPath).replace(/\.(vtube|prprl2d)\.json$/i, '')
        candidates.push(path.join(folder, `${stem}.model3.json`))
        candidates.push(path.join(folder, `${stem}.model.json`))
      }
      for (const filePath of candidates) {
        if (this.isModelEntryFile(filePath) && fs.existsSync(filePath)) {
          return filePath
        }
      }
    } catch (error) {
      this.addRuntimeLog(
        'warn',
        `Live2D 伴随配置读取失败: ${metaPath} | ${this.describeError(error)}`,
        'live2d'
      )
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
        throw new Error('请选择 Live2D 模型文件（.model3.json/.model.json/.vtube.json/.prprl2d.json）')
      }
      if (this.isModelEntryFile(normalized)) {
        return normalized
      }
      const companion = await this.resolveCompanionModelPath(normalized)
      if (companion) return companion
      let nearbyJson = '无'
      try {
        nearbyJson = (await fs.promises.readdir(path.dirname(normalized)))
          .filter((name) => /\.json$/i.test(name))
          .slice(0, 6)
          .join(', ') || '无'
      } catch {
        // ignore list failure
      }
      this.addRuntimeLog(
        'warn',
        `Live2D 配置未定位到模型入口: ${normalized} | 同目录 JSON: ${nearbyJson}`,
        'live2d'
      )
      throw new Error('无法从所选配置文件定位到 .model3.json/.model.json 模型入口')
    }
    if (stat.isDirectory()) {
      const modelPath = await this.findLive2DModelInFolder(normalized)
      if (!modelPath) {
        let jsonSample = '无'
        try {
          jsonSample = (await fs.promises.readdir(normalized))
            .filter((name) => /\.json$/i.test(name))
            .slice(0, 8)
            .join(', ') || '无'
        } catch {
          // ignore list failure
        }
        this.addRuntimeLog(
          'warn',
          `Live2D 文件夹未找到模型入口: ${normalized} | JSON示例: ${jsonSample}`,
          'live2d'
        )
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
      const modelDir = path.dirname(modelPath)
      const modelStem = path.basename(modelPath).replace(/\.(model3|model)\.json$/i, '')
      let fromModelExpression = 0
      let fromModelMotion = 0
      let fromCompanionExpression = 0
      let fromCompanionMotion = 0
      let fromScanExpression = 0
      let fromScanMotion = 0
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
        if (name && !expression[name]) {
          expression[name] = name
          fromModelExpression += 1
        }
      }

      const motionsV3 = json?.FileReferences?.Motions
      const motionsV2 = json?.motions
      const motionObj =
        motionsV3 && typeof motionsV3 === 'object' ? motionsV3 : motionsV2 && typeof motionsV2 === 'object' ? motionsV2 : {}
      for (const key of Object.keys(motionObj)) {
        const groupName = String(key || '').trim()
        if (groupName && !motion[groupName]) {
          motion[groupName] = groupName
          fromModelMotion += 1
        }
        const items = Array.isArray(motionObj[key]) ? motionObj[key] : []
        for (const item of items) {
          const motionName = pickNameFromFile(item?.File || item?.file)
          if (motionName && !motion[motionName]) {
            motion[motionName] = motionName
            fromModelMotion += 1
          }
        }
      }

      const readCompanionActions = async (companionPath: string) => {
        if (!fs.existsSync(companionPath)) return
        try {
          const rawCompanion = await fs.promises.readFile(companionPath, 'utf-8')
          const parsed = JSON.parse(rawCompanion)

          const hotkeys = Array.isArray(parsed?.Hotkeys) ? parsed.Hotkeys : []
          for (const item of hotkeys) {
            const actionType = String(item?.Action || item?.action || '').trim().toLowerCase()
            const alias = String(item?.Name || item?.name || '').trim()
            const target = pickNameFromFile(item?.File || item?.file)
            const name = alias || target
            if (!name && !target) continue
            if (actionType.includes('expression')) {
              const mapped = target || name
              if (!expression[name]) {
                expression[name] = mapped
                fromCompanionExpression += 1
              }
              if (mapped && !expression[mapped]) {
                expression[mapped] = mapped
                fromCompanionExpression += 1
              }
            } else {
              const mapped = target || name
              if (!motion[name]) {
                motion[name] = mapped
                fromCompanionMotion += 1
              }
              if (mapped && !motion[mapped]) {
                motion[mapped] = mapped
                fromCompanionMotion += 1
              }
            }
          }
        } catch (error) {
          this.addRuntimeLog(
            'warn',
            `Live2D 伴随配置解析失败: ${companionPath} | ${this.describeError(error)}`,
            'live2d'
          )
        }
      }

      await readCompanionActions(path.join(modelDir, `${modelStem}.vtube.json`))
      await readCompanionActions(path.join(modelDir, `${modelStem}.prprl2d.json`))

      const collectFiles = async (folder: string, matcher: RegExp, depth = 0): Promise<string[]> => {
        if (depth > 3) return []
        const result: string[] = []
        let entries: fs.Dirent[]
        try {
          entries = await fs.promises.readdir(folder, { withFileTypes: true })
        } catch (error) {
          this.addRuntimeLog(
            'warn',
            `Live2D 动作文件扫描失败: ${folder} | ${this.describeError(error)}`,
            'live2d'
          )
          return result
        }
        for (const entry of entries) {
          const fullPath = path.join(folder, entry.name)
          if (entry.isDirectory()) {
            result.push(...(await collectFiles(fullPath, matcher, depth + 1)))
            continue
          }
          if (entry.isFile() && matcher.test(entry.name)) {
            result.push(fullPath)
          }
        }
        return result
      }

      if (Object.keys(expression).length === 0) {
        const expressionFiles = await collectFiles(modelDir, /\.exp3\.json$/i)
        for (const filePath of expressionFiles) {
          const name = pickNameFromFile(filePath)
          if (name && !expression[name]) {
            expression[name] = name
            fromScanExpression += 1
          }
        }
      }

      if (Object.keys(motion).length === 0) {
        const motionFiles = await collectFiles(modelDir, /\.(motion3\.json|mtn)$/i)
        for (const filePath of motionFiles) {
          const name = pickNameFromFile(filePath)
          if (name && !motion[name]) {
            motion[name] = name
            fromScanMotion += 1
          }
        }
      }

      const expressionSample =
        Object.entries(expression)
          .slice(0, 5)
          .map(([alias, target]) => `${alias}->${target}`)
          .join(', ') || '无'
      const motionSample =
        Object.entries(motion)
          .slice(0, 5)
          .map(([alias, target]) => `${alias}->${target}`)
          .join(', ') || '无'
      this.addRuntimeLog(
        'info',
        `Live2D 映射解析详情: model(exp:${fromModelExpression},motion:${fromModelMotion}) companion(exp:${fromCompanionExpression},motion:${fromCompanionMotion}) scan(exp:${fromScanExpression},motion:${fromScanMotion}) | exp示例: ${expressionSample} | motion示例: ${motionSample}`,
        'live2d'
      )
      if (Object.keys(expression).length === 0 && Object.keys(motion).length === 0) {
        this.addRuntimeLog(
          'warn',
          `Live2D 映射读取结果为空: ${modelPath}。请检查模型目录中的 Expressions/Motions、*.exp3.json、*.motion3.json 是否存在且可读取。`,
          'live2d'
        )
      }

      return { expression, motion }
    } catch (error) {
      this.addRuntimeLog(
        'error',
        `Live2D 映射解析失败: ${modelPath} | ${this.describeError(error)}`,
        'live2d'
      )
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
          this.addRuntimeLog(
            'error',
            `Live2D 模型路径解析失败: ${value} | ${this.describeError(error)}`,
            'live2d'
          )
          throw error
        }
        if (nextValue) {
          const modelPath = String(nextValue)
          const parsed = await this.loadLive2DActionMap(String(nextValue))
          const config = this.configManager.getAll()
          const modelKey = this.normalizeModelKey(modelPath)
          const allModelMaps = { ...(config.live2dModelActionMaps || {}) }
          const existingForModel = this.sanitizeLive2DActionMap(allModelMaps[modelKey])
          const merged = this.mergeLive2DActionMaps(parsed, existingForModel)
          allModelMaps[modelKey] = merged
          this.configManager.set('live2dModelActionMaps', allModelMaps)
          this.configManager.set('live2dActionMap', merged)
          this.upsertLive2DModelRecord(modelPath)
          this.addRuntimeLog(
            'info',
            `Live2D 映射已自动读取并切换: ${modelPath} | 自动读取 expression ${Object.keys(parsed.expression).length} 项, motion ${Object.keys(parsed.motion).length} 项 | 当前生效 expression ${Object.keys(merged.expression).length} 项, motion ${Object.keys(merged.motion).length} 项`,
            'live2d'
          )
        }
      }
      if (key === 'live2dActionMap') {
        const normalized = this.sanitizeLive2DActionMap(value)
        nextValue = normalized
        const currentModelPath = this.configManager.getAll().live2dModelPath
        if (currentModelPath) {
          const modelKey = this.normalizeModelKey(currentModelPath)
          const allModelMaps = { ...(this.configManager.getAll().live2dModelActionMaps || {}) }
          allModelMaps[modelKey] = normalized
          this.configManager.set('live2dModelActionMaps', allModelMaps)
          this.addRuntimeLog('info', `Live2D 映射已保存到当前模型: ${currentModelPath}`, 'live2d')
        }
      }
      this.configManager.set(key, nextValue)
      let hotkeyResult:
        | { applied: { toggleChat: string; toggleLive2D: string }; warnings: string[] }
        | undefined
      if (key === 'live2dModelPath' && typeof value === 'string') {
        const modelPath = String(nextValue || '')
        if (modelPath) {
          this.addRuntimeLog('info', `配置变更触发 Live2D 切换模型: ${modelPath}`, 'live2d')
          this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_LOAD_MODEL, modelPath)
          this.live2dWindow?.show()
        } else {
          this.addRuntimeLog('warn', '配置已清空 Live2D 模型路径，窗口将隐藏', 'live2d')
          this.live2dWindow?.hide()
        }
      }
      if (key === 'live2dBehavior') {
        this.addRuntimeLog('info', '配置变更触发 Live2D 行为更新', 'live2d')
        this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_BEHAVIOR_UPDATE, {
          ...this.configManager.getAll().live2dBehavior,
        })
      }
      if (key === 'live2dControls') {
        this.addRuntimeLog('info', '配置变更触发 Live2D 功能按钮更新', 'live2d')
        this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_CONTROLS_UPDATE, {
          ...this.configManager.getAll().live2dControls,
        })
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
        this.syncLive2DWindowBounds('config-window')
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
    ipcMain.handle(IPC_CHANNELS.FILE_LIST, async (_e, folderPath: string, recursive = false) =>
      this.toolManager.execute('file_list', { path: folderPath, recursive: Boolean(recursive) })
    )
    ipcMain.handle(IPC_CHANNELS.FILE_OPEN_IN_BROWSER, async (_e, filePath: string) => shell.openPath(filePath))

    ipcMain.handle(IPC_CHANNELS.LIVE2D_ACTION, (_e, action) => {
      this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_ACTION, action)
    })
    ipcMain.handle(IPC_CHANNELS.LIVE2D_LOAD_MODEL, (_e, modelPath: string) => {
      this.addRuntimeLog('info', `IPC 收到 Live2D 加载请求: ${modelPath}`, 'live2d')
      this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_LOAD_MODEL, modelPath)
    })
    ipcMain.handle(IPC_CHANNELS.LIVE2D_SHOW_REPLY, (_e, text: string) => {
      this.live2dWindow?.webContents.send(IPC_CHANNELS.LIVE2D_SHOW_REPLY, text)
    })

    ipcMain.handle(IPC_CHANNELS.TRIGGER_INVOKE, (_e, ctx: InvokeContext) => {
      this.dispatchTrigger(ctx, 'trigger-ipc')
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
        } else {
          window.close() // 其他窗口关闭
        }
      }
    })
    ipcMain.handle(IPC_CHANNELS.WINDOW_DRAG_BEGIN, (e, payload: { x: number; y: number }) =>
      this.beginWindowDrag(e.sender, Number(payload?.x || 0), Number(payload?.y || 0))
    )
    ipcMain.handle(IPC_CHANNELS.WINDOW_DRAG_UPDATE, (e, payload: { x: number; y: number }) =>
      this.updateWindowDrag(e.sender, Number(payload?.x || 0), Number(payload?.y || 0))
    )
    ipcMain.handle(IPC_CHANNELS.WINDOW_DRAG_END, (e) => this.endWindowDrag(e.sender))
    ipcMain.handle(IPC_CHANNELS.WINDOW_SET_MOUSE_PASSTHROUGH, (e, payload: { enabled: boolean }) =>
      this.setWindowMousePassthrough(e.sender, Boolean(payload?.enabled))
    )
    ipcMain.handle(
      IPC_CHANNELS.WINDOW_RESIZE_BEGIN,
      (
        e,
        payload: {
          edge:
            | 'top'
            | 'right'
            | 'bottom'
            | 'left'
            | 'top-left'
            | 'top-right'
            | 'bottom-left'
            | 'bottom-right'
          x: number
          y: number
        }
      ) =>
        this.beginWindowResize(
          e.sender,
          payload?.edge || 'right',
          Number(payload?.x || 0),
          Number(payload?.y || 0)
        )
    )
    ipcMain.handle(IPC_CHANNELS.WINDOW_RESIZE_UPDATE, (e, payload: { x: number; y: number }) =>
      this.updateWindowResize(e.sender, Number(payload?.x || 0), Number(payload?.y || 0))
    )
    ipcMain.handle(IPC_CHANNELS.WINDOW_RESIZE_END, (e) => this.endWindowResize(e.sender))

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
      this.addRuntimeLog('info', `开始监听目录: ${folder}`, 'watcher')
      this.fileWatcher.watch(folder, (eventType, filePath) => {
        const data = { type: eventType, path: filePath }
        this.addRuntimeLog('info', `文件变动事件: ${eventType} | ${filePath}`, 'watcher')
        this.chatWindow?.webContents.send(IPC_CHANNELS.FILE_WATCH_EVENT, data)
        const ctx: InvokeContext = {
          trigger: 'file_change',
          fileChangeInfo: { type: eventType as 'add' | 'change' | 'unlink', filePath },
        }
        this.dispatchTrigger(ctx, 'watcher')
      })
    }
  }

  private startRandomTimer() {
    const config = this.configManager.getAll()
    const { min, max } = config.randomTimerRange
    const delay = (Math.random() * (max - min) + min) * 60 * 1000
    this.addRuntimeLog('info', `随机触发计时已设置: ${(delay / 1000 / 60).toFixed(2)} 分钟后`, 'trigger-timer')
    this.randomTimer = setTimeout(() => {
      const ctx: InvokeContext = { trigger: 'random_timer' }
      this.dispatchTrigger(ctx, 'trigger-timer')
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
