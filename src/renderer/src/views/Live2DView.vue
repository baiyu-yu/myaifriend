<template>
  <div class="live2d-container">
    <div class="drag-bar" @click.stop @mousedown.stop="startDragWindow" />
    <canvas ref="canvasRef" @click="handleClick" />

    <div v-if="replyText" class="reply-bubble" @click.stop>
      <div class="reply-content">{{ replyText }}</div>
    </div>

    <div class="control-toggle" @click.stop @mousedown.stop>
      <button type="button" class="control-toggle-btn" @click="toggleControlPanel">
        {{ showControlPanel ? '收起' : '动作' }}
      </button>
    </div>

    <div v-if="showControlPanel" class="control-panel" @click.stop @mousedown.stop>
      <div class="control-row">
        <select v-model="selectedExpression">
          <option value="">选择表情</option>
          <option v-for="item in expressionOptions" :key="`exp-${item}`" :value="item">{{ item }}</option>
        </select>
        <button type="button" @click="triggerExpressionManually">触发表情</button>
      </div>
      <div class="control-row">
        <select v-model="selectedMotion">
          <option value="">选择动作</option>
          <option v-for="item in motionOptions" :key="`mot-${item}`" :value="item">{{ item }}</option>
        </select>
        <button type="button" @click="triggerMotionManually">触发动作</button>
      </div>
    </div>

    <div class="resize-handle top" @mousedown.stop.prevent="startResizeWindow('top', $event)" />
    <div class="resize-handle right" @mousedown.stop.prevent="startResizeWindow('right', $event)" />
    <div class="resize-handle bottom" @mousedown.stop.prevent="startResizeWindow('bottom', $event)" />
    <div class="resize-handle left" @mousedown.stop.prevent="startResizeWindow('left', $event)" />
    <div class="resize-handle top-left" @mousedown.stop.prevent="startResizeWindow('top-left', $event)" />
    <div class="resize-handle top-right" @mousedown.stop.prevent="startResizeWindow('top-right', $event)" />
    <div class="resize-handle bottom-left" @mousedown.stop.prevent="startResizeWindow('bottom-left', $event)" />
    <div class="resize-handle bottom-right" @mousedown.stop.prevent="startResizeWindow('bottom-right', $event)" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as PIXI from 'pixi.js'
import cubismCoreRuntimeUrl from 'live2dcubismcore/live2dcubismcore.min.js?url'
import type { Live2DModel as Live2DModelType } from 'pixi-live2d-display/cubism4'
import type { Live2DAction } from '../../../common/types'
import { useConfigStore } from '../stores/config'

const canvasRef = ref<HTMLCanvasElement>()
const replyText = ref('')
const selectedExpression = ref('')
const selectedMotion = ref('')
const expressionOptions = ref<string[]>([])
const motionOptions = ref<string[]>([])
const showControlPanel = ref(false)

const configStore = useConfigStore()
const cleanups: Array<() => void> = []

let pixiApp: PIXI.Application | null = null
let currentModel: Live2DModelType | null = null
let replyTimer: ReturnType<typeof setTimeout> | null = null
let idleTicker: ((delta: number) => void) | null = null
let baseX = 0
let baseRotation = 0
let swayTime = 0
let live2DModelCtor: typeof import('pixi-live2d-display/cubism4').Live2DModel | null = null
let motionPriorityNormal = 2
let motionPriorityForce = 3
const runtimeScriptTasks = new Map<string, Promise<boolean>>()
const logDedupCache = new Map<string, number>()
const behaviorState = ref({
  enableIdleSway: true,
  idleSwayAmplitude: 8,
  idleSwaySpeed: 0.8,
  enableEyeTracking: false,
})
let focusTargetX = window.innerWidth / 2
let focusTargetY = window.innerHeight * 0.45
let focusCurrentX = focusTargetX
let focusCurrentY = focusTargetY
let trackingMouseInside = false
let lastPointerX = 0
let lastPointerY = 0
let draggingWindow = false
let resizingEdge:
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | null = null
let lastInteractionState = ''
let removeDragResizeListeners: (() => void) | null = null
let mousePassthroughEnabled = false

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const stack = error.stack?.split('\n').slice(0, 2).join(' > ')
    return stack ? `${error.message} | ${stack}` : error.message
  }
  return String(error)
}

function logLive2D(level: 'info' | 'warn' | 'error', message: string) {
  const key = `${level}:${message}`
  const now = Date.now()
  const last = logDedupCache.get(key) || 0
  if (level === 'info' && now - last < 1200) return
  logDedupCache.set(key, now)
  void window.electronAPI.app.log.add(level, message, 'live2d')
}

function sanitizeBehavior(input: any) {
  return {
    enableIdleSway: input?.enableIdleSway !== false,
    idleSwayAmplitude: Math.max(0, Number(input?.idleSwayAmplitude ?? 8) || 0),
    idleSwaySpeed: Math.max(0.05, Number(input?.idleSwaySpeed ?? 0.8) || 0.8),
    enableEyeTracking: Boolean(input?.enableEyeTracking),
  }
}

function applyBehavior(input: any, source: string) {
  const next = sanitizeBehavior(input)
  const prev = behaviorState.value
  behaviorState.value = next
  if (
    prev.enableIdleSway !== next.enableIdleSway ||
    prev.idleSwayAmplitude !== next.idleSwayAmplitude ||
    prev.idleSwaySpeed !== next.idleSwaySpeed ||
    prev.enableEyeTracking !== next.enableEyeTracking
  ) {
    logLive2D(
      'info',
      `Live2D 行为参数已更新: source=${source}, sway=${next.enableIdleSway}, amp=${next.idleSwayAmplitude}, speed=${next.idleSwaySpeed}, eye=${next.enableEyeTracking}`
    )
  }
}

function syncActionOptionsFromConfig() {
  const expMap = configStore.config.live2dActionMap?.expression || {}
  const motMap = configStore.config.live2dActionMap?.motion || {}
  const exp = new Set<string>(Object.keys(expMap))
  const mot = new Set<string>(Object.keys(motMap))
  if (exp.size === 0) {
    for (const value of Object.values(expMap)) exp.add(value)
  }
  if (mot.size === 0) {
    for (const value of Object.values(motMap)) mot.add(value)
  }
  expressionOptions.value = Array.from(exp).filter(Boolean)
  motionOptions.value = Array.from(mot).filter(Boolean)
  if (!expressionOptions.value.includes(selectedExpression.value) && expressionOptions.value.length > 0) {
    selectedExpression.value = expressionOptions.value[0]
  }
  if (!motionOptions.value.includes(selectedMotion.value) && motionOptions.value.length > 0) {
    selectedMotion.value = motionOptions.value[0]
  }
}

function ensureInteractionManagerCompat(manager: any): void {
  if (!manager || typeof manager !== 'object') return

  if (typeof manager.on !== 'function') {
    if (typeof manager.addListener === 'function') {
      manager.on = manager.addListener.bind(manager)
    } else if (typeof manager.addEventListener === 'function') {
      manager.on = (event: string, handler: (...args: any[]) => void, context?: any) => {
        if (context) {
          const wrapped = handler.bind(context)
          manager.addEventListener(event, wrapped)
          return wrapped
        }
        manager.addEventListener(event, handler)
        return handler
      }
    }
  }

  if (typeof manager.off !== 'function') {
    if (typeof manager.removeListener === 'function') {
      manager.off = manager.removeListener.bind(manager)
    } else if (typeof manager.removeEventListener === 'function') {
      manager.off = (event: string, handler: (...args: any[]) => void, context?: any) => {
        manager.removeEventListener(event, context ? handler.bind(context) : handler)
      }
    } else {
      manager.off = () => undefined
    }
  }
}

function patchRendererInteractionManager(reason: string): void {
  const manager = (pixiApp as any)?.renderer?.plugins?.interaction
  if (!manager) {
    if (lastInteractionState !== 'none') {
      logLive2D('warn', `Live2D interaction manager 不存在: reason=${reason}`)
      lastInteractionState = 'none'
    }
    return
  }
  const hasOn = typeof manager.on === 'function'
  const hasOff = typeof manager.off === 'function'
  if (!hasOn || !hasOff) {
    ensureInteractionManagerCompat(manager)
    const nextState = `patched:on=${typeof manager.on === 'function'},off=${typeof manager.off === 'function'}`
    if (lastInteractionState !== nextState) {
      logLive2D(
        'warn',
        `Live2D interaction manager 已做兼容补丁: reason=${reason}, before(on=${hasOn},off=${hasOff}), after(on=${typeof manager.on === 'function'},off=${typeof manager.off === 'function'})`
      )
      lastInteractionState = nextState
    }
    return
  }
  lastInteractionState = 'ready'
}

function destroyCurrentModelSafely(reason: string): void {
  if (!currentModel || !pixiApp) return

  patchRendererInteractionManager(`destroy-${reason}`)
  try {
    pixiApp.stage.removeChild(currentModel as any)
  } catch (error) {
    logLive2D('warn', `Live2D 移除旧模型失败: reason=${reason} | ${describeError(error)}`)
  }

  try {
    currentModel.destroy()
  } catch (error) {
    logLive2D('warn', `Live2D 旧模型销毁异常(已忽略): reason=${reason} | ${describeError(error)}`)
  } finally {
    currentModel = null
  }
}

function getRuntimeGlobal(name: string): unknown {
  return (window as unknown as Record<string, unknown>)[name]
}

function loadGlobalRuntimeScript(src: string, globalName: string): Promise<boolean> {
  if (getRuntimeGlobal(globalName)) {
    return Promise.resolve(true)
  }

  const cachedTask = runtimeScriptTasks.get(src)
  if (cachedTask) {
    return cachedTask
  }

  const task = new Promise<boolean>((resolve) => {
    const script = document.createElement('script')
    script.async = true
    script.src = src
    script.onload = () => {
      resolve(Boolean(getRuntimeGlobal(globalName)))
    }
    script.onerror = () => {
      resolve(false)
    }
    document.head.appendChild(script)
  }).finally(() => {
    if (!getRuntimeGlobal(globalName)) {
      runtimeScriptTasks.delete(src)
    }
  })

  runtimeScriptTasks.set(src, task)
  return task
}

async function ensureLive2DRuntime(): Promise<boolean> {
  if (live2DModelCtor) return true

  logLive2D('info', `Live2D 运行时准备开始: cubismCore=${cubismCoreRuntimeUrl}`)
  ;(window as any).PIXI = PIXI
  const coreReady = await loadGlobalRuntimeScript(cubismCoreRuntimeUrl, 'Live2DCubismCore')
  if (!coreReady) {
    logLive2D('error', 'Live2D 运行时加载失败：Cubism Core 未就绪')
    return false
  }
  logLive2D('info', 'Live2D Cubism Core 已就绪')

  try {
    const module = await import('pixi-live2d-display/cubism4')
    live2DModelCtor = module.Live2DModel
    motionPriorityNormal = module.MotionPriority.NORMAL
    motionPriorityForce = module.MotionPriority.FORCE
    logLive2D(
      'info',
      `Live2D cubism4 模块已加载: NORMAL=${motionPriorityNormal}, FORCE=${motionPriorityForce}`
    )
    try {
      live2DModelCtor.registerTicker((PIXI as any).Ticker)
    } catch {
      // ignore duplicated ticker registration
    }
    return true
  } catch (error) {
    logLive2D('error', `Live2D 运行时初始化失败: ${describeError(error)}`)
    return false
  }
}

function toFileUrl(normalizedPath: string): string {
  const url = new URL('file:///')
  url.pathname = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`
  return url.toString()
}

function toModelUrls(inputPath: string): string[] {
  const modelPath = inputPath.trim()
  if (!modelPath) return []

  if (/^https?:\/\//i.test(modelPath) || /^file:\/\//i.test(modelPath)) {
    return [modelPath]
  }

  const normalized = modelPath.replace(/\\/g, '/')
  const legacy = /^[a-zA-Z]:\//.test(normalized) ? `file:///${normalized}` : `file://${normalized}`
  const escapedLegacy = encodeURI(legacy).replace(/#/g, '%23').replace(/\?/g, '%3F')
  return Array.from(new Set([toFileUrl(normalized), legacy, escapedLegacy]))
}

function resolveModelSize(model: Live2DModelType): { width: number; height: number } {
  const fallback = {
    width: Math.max(1, model.width),
    height: Math.max(1, model.height),
  }
  try {
    const bounds = model.getLocalBounds()
    const width = Number.isFinite(bounds?.width) ? Math.max(1, bounds.width) : fallback.width
    const height = Number.isFinite(bounds?.height) ? Math.max(1, bounds.height) : fallback.height
    return { width, height }
  } catch {
    return fallback
  }
}

function fitModel(model: Live2DModelType, reason = 'fit') {
  if (!pixiApp) return

  const stageWidth = window.innerWidth
  const stageHeight = window.innerHeight
  const { width: modelWidth, height: modelHeight } = resolveModelSize(model)

  const rawScale = Math.min((stageWidth * 0.85) / modelWidth, (stageHeight * 0.9) / modelHeight)
  const scale = Number.isFinite(rawScale) ? Math.min(3, Math.max(0.05, rawScale)) : 0.4
  model.scale.set(scale)
  model.anchor.set(0.5, 1)
  model.x = stageWidth / 2
  model.y = stageHeight - 6
  baseX = model.x
  baseRotation = model.rotation
  const shouldLog =
    reason === 'initial' || reason === 'retry-900ms' || reason === 'resize' || reason === 'fit'
  if (shouldLog) {
    logLive2D(
      'info',
      `Live2D 模型布局完成: reason=${reason}, stage=${stageWidth}x${stageHeight}, model=${modelWidth.toFixed(1)}x${modelHeight.toFixed(1)}, scale=${scale.toFixed(3)}, pos=(${model.x.toFixed(1)},${model.y.toFixed(1)})`
    )
  }
}

function fitModelWithRetry(model: Live2DModelType) {
  fitModel(model, 'initial')
  for (const delay of [120, 360, 900]) {
    const timer = setTimeout(() => {
      if (currentModel !== model) return
      fitModel(model, `retry-${delay}ms`)
    }, delay)
    cleanups.push(() => clearTimeout(timer))
  }
}

async function playInitialMotion(model: Live2DModelType) {
  const motionMap = configStore.config.live2dActionMap?.motion || {}
  const motionNames = Object.values(motionMap)
  if (motionNames.length === 0) return

  const lowered = motionNames.map((name) => ({ raw: name, lower: name.toLowerCase() }))
  const preferred =
    lowered.find((item) => item.lower.includes('idle'))?.raw ||
    lowered.find((item) => item.lower.includes('home'))?.raw ||
    lowered.find((item) => item.lower.includes('login'))?.raw ||
    lowered[0]?.raw
  if (!preferred) return

  try {
    await model.motion(preferred, undefined, motionPriorityNormal)
    void window.electronAPI.app.log.add('info', `Live2D 初始动作已播放: ${preferred}`, 'live2d')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    void window.electronAPI.app.log.add('warn', `Live2D 初始动作播放失败: ${preferred} | ${message}`, 'live2d')
  }
}

async function loadModel(modelPath: string) {
  if (!pixiApp || !modelPath) return

  logLive2D('info', `Live2D 模型加载请求: ${modelPath}`)
  const runtimeReady = await ensureLive2DRuntime()
  if (!runtimeReady || !live2DModelCtor) return

  const urls = toModelUrls(modelPath)
  logLive2D('info', `Live2D 模型候选路径: ${urls.join(' || ')}`)
  if (urls.length === 0) return

  try {
    destroyCurrentModelSafely('loadModel')

    let model: Live2DModelType | null = null
    const attemptErrors: string[] = []
    for (const url of urls) {
      try {
        model = await live2DModelCtor.from(url, {
          autoInteract: false,
          autoUpdate: true,
        } as any)
        if (url === urls[0]) {
          logLive2D('info', `Live2D 模型已从主路径加载: ${url}`)
        } else {
          logLive2D('warn', `Live2D 模型已使用回退路径加载: ${url}`)
        }
        break
      } catch (error) {
        const detail = describeError(error)
        attemptErrors.push(`${url} => ${detail}`)
        logLive2D('warn', `Live2D 模型路径加载失败: ${url} | ${detail}`)
      }
    }
    if (!model) {
      throw new Error(attemptErrors.slice(0, 3).join(' | '))
    }

    currentModel = model
    ;(currentModel as any).autoInteract = false
    patchRendererInteractionManager('after-model-created')
    model.interactive = true
    pixiApp.stage.addChild(model as any)
    fitModelWithRetry(model)
    await playInitialMotion(model)
    const textureCount = Array.isArray((model as any).textures) ? (model as any).textures.length : 0
    const motionGroupCount = Object.keys((model as any)?.internalModel?.motionManager?.definitions || {}).length
    const expressionCount = Array.isArray((model as any)?.internalModel?.expressionManager?.definitions)
      ? (model as any).internalModel.expressionManager.definitions.length
      : 0
    logLive2D(
      'info',
      `Live2D 模型加载成功: ${modelPath} | texture=${textureCount}, motionGroup=${motionGroupCount}, expression=${expressionCount}`
    )
  } catch (error) {
    const detail = describeError(error)
    logLive2D('warn', `Live2D 模型加载异常详情: ${detail}`)
    logLive2D('error', `Live2D 模型加载失败: ${modelPath} | ${detail}`)
  }
}

function normalizeActionToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function resolveActionMap(type: 'expression' | 'motion'): Record<string, string> {
  const map = configStore.config.live2dActionMap
  if (!map) return {}
  return type === 'expression' ? map.expression || {} : map.motion || {}
}

function resolveMappedActionName(action: Live2DAction): string {
  if (action.type !== 'expression' && action.type !== 'motion') return action.name
  const input = action.name.trim()
  if (!input) return ''
  const map = resolveActionMap(action.type)
  if (map[input]) return map[input]

  const lowered = input.toLowerCase()
  for (const [alias, target] of Object.entries(map)) {
    if (alias.toLowerCase() === lowered) return target
  }
  for (const [alias, target] of Object.entries(map)) {
    if (target === input || target.toLowerCase() === lowered) return alias
  }
  return input
}

function collectAvailableActionNames(type: 'expression' | 'motion'): string[] {
  if (!currentModel) return []
  if (type === 'motion') {
    const defs = (currentModel as any)?.internalModel?.motionManager?.definitions || {}
    return Object.keys(defs).filter(Boolean)
  }

  const defs = (currentModel as any)?.internalModel?.expressionManager?.definitions
  if (!Array.isArray(defs)) return []
  const names = new Set<string>()
  for (const item of defs) {
    const raw =
      typeof item === 'string'
        ? item
        : String(item?.Name || item?.name || item?.File || item?.file || '').trim()
    if (!raw) continue
    names.add(raw)
    names.add(raw.replace(/\.(exp3\.json|json)$/i, ''))
  }
  return Array.from(names)
}

function findBestAvailableName(candidates: string[], available: string[]): string {
  if (available.length === 0) return candidates[0] || ''
  const cleanCandidates = candidates.map((item) => item.trim()).filter(Boolean)
  for (const candidate of cleanCandidates) {
    if (available.includes(candidate)) return candidate
  }
  for (const candidate of cleanCandidates) {
    const lower = candidate.toLowerCase()
    const hit = available.find((name) => name.toLowerCase() === lower)
    if (hit) return hit
  }
  for (const candidate of cleanCandidates) {
    const normalized = normalizeActionToken(candidate)
    const hit = available.find((name) => normalizeActionToken(name) === normalized)
    if (hit) return hit
  }
  return cleanCandidates[0] || ''
}

async function performAction(action: Live2DAction): Promise<{ ok: boolean; resolvedName: string }> {
  if (!currentModel) return { ok: false, resolvedName: '' }
  if (action.type !== 'expression' && action.type !== 'motion') {
    return { ok: false, resolvedName: action.name }
  }

  const mapped = resolveMappedActionName(action).trim()
  const original = action.name.trim()
  const available = collectAvailableActionNames(action.type)
  const primary = findBestAvailableName([mapped, original], available)
  const candidates = Array.from(new Set([primary, mapped, original].map((item) => item.trim()).filter(Boolean)))

  const executeByName = async (name: string) => {
    if (action.type === 'expression') {
      await currentModel!.expression(name)
      return
    }
    const priority = action.priority === 3 ? motionPriorityForce : motionPriorityNormal
    await currentModel!.motion(name, undefined, priority)
  }

  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      await executeByName(candidate)
      return { ok: true, resolvedName: candidate }
    } catch (error) {
      errors.push(`${candidate}: ${describeError(error)}`)
    }
  }

  const availableSample = available.slice(0, 8).join(', ') || '无'
  logLive2D(
    'warn',
    `Live2D 动作执行失败: type=${action.type}, input=${action.name}, mapped=${mapped || '空'}, available=${availableSample}, errors=${errors.slice(0, 2).join(' | ') || '无'}`
  )
  return { ok: false, resolvedName: mapped || original }
}

function setMousePassthrough(enabled: boolean) {
  if (mousePassthroughEnabled === enabled) return
  mousePassthroughEnabled = enabled
  void window.electronAPI.window.setMousePassthrough(enabled)
}

function isPointInsideModel(clientX: number, clientY: number): boolean {
  if (!canvasRef.value || !currentModel) return false
  const rect = canvasRef.value.getBoundingClientRect()
  const localX = clientX - rect.left
  const localY = clientY - rect.top
  if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) return false
  try {
    const bounds = currentModel.getBounds()
    return (
      localX >= bounds.x &&
      localX <= bounds.x + bounds.width &&
      localY >= bounds.y &&
      localY <= bounds.y + bounds.height
    )
  } catch {
    return false
  }
}

function isPointerOnInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('.control-panel, .control-toggle, .reply-bubble, .resize-handle, .drag-bar'))
}

function updateMousePassthroughByPointer(event: MouseEvent) {
  if (draggingWindow || resizingEdge) {
    setMousePassthrough(false)
    return
  }
  const onInteractiveElement = isPointerOnInteractiveElement(event.target)
  const onModel = isPointInsideModel(event.clientX, event.clientY)
  setMousePassthrough(!(onInteractiveElement || onModel))
}

function showReply(text: string) {
  if (replyTimer) clearTimeout(replyTimer)
  replyText.value = text
  replyTimer = setTimeout(() => {
    replyText.value = ''
  }, 10000)
}

function handleResize() {
  if (!pixiApp || !currentModel) return
  pixiApp.renderer.resize(window.innerWidth, window.innerHeight)
  fitModel(currentModel, 'resize')
  focusTargetX = window.innerWidth / 2
  focusTargetY = window.innerHeight * 0.45
  if (lastPointerX > 0 || lastPointerY > 0) {
    updateMousePassthroughByPointer(
      new MouseEvent('mousemove', {
        clientX: lastPointerX,
        clientY: lastPointerY,
      })
    )
  }
}

function handleMouseMove(event: MouseEvent) {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  lastPointerX = event.clientX
  lastPointerY = event.clientY
  trackingMouseInside = true
  focusTargetX = Math.max(rect.left, Math.min(rect.right, event.clientX))
  focusTargetY = Math.max(rect.top, Math.min(rect.bottom, event.clientY))
  updateMousePassthroughByPointer(event)
}

function handleMouseLeave() {
  trackingMouseInside = false
  focusTargetX = window.innerWidth / 2
  focusTargetY = window.innerHeight * 0.45
  setMousePassthrough(true)
}

function handleClick(event: MouseEvent) {
  window.electronAPI.trigger.invoke({ trigger: 'click_avatar' })
  if (currentModel) {
    currentModel.tap(event.clientX, event.clientY)
  }
}

function toggleControlPanel() {
  showControlPanel.value = !showControlPanel.value
}

async function triggerExpressionManually() {
  const name = selectedExpression.value.trim()
  if (!name) return
  const result = await performAction({ type: 'expression', name })
  if (result.ok) {
    logLive2D('info', `Live2D 手动触发表情成功: ${name} => ${result.resolvedName}`)
  } else {
    logLive2D('warn', `Live2D 手动触发表情失败: ${name}`)
  }
}

async function triggerMotionManually() {
  const name = selectedMotion.value.trim()
  if (!name) return
  const result = await performAction({ type: 'motion', name, priority: 3 })
  if (result.ok) {
    logLive2D('info', `Live2D 手动触发动作成功: ${name} => ${result.resolvedName}`)
  } else {
    logLive2D('warn', `Live2D 手动触发动作失败: ${name}`)
  }
}

function stopActiveDragResize() {
  if (draggingWindow) {
    draggingWindow = false
    void window.electronAPI.window.dragEnd()
  }
  if (resizingEdge) {
    resizingEdge = null
    void window.electronAPI.window.resizeEnd()
  }
}

function bindDragResizeListeners() {
  if (removeDragResizeListeners) {
    removeDragResizeListeners()
  }
  const onMove = (event: MouseEvent) => {
    if (event.buttons === 0 && (draggingWindow || resizingEdge)) {
      stopActiveDragResize()
      return
    }
    if (draggingWindow) {
      void window.electronAPI.window.dragUpdate(event.screenX, event.screenY)
    }
    if (resizingEdge) {
      void window.electronAPI.window.resizeUpdate(event.screenX, event.screenY)
    }
  }
  const onUp = () => {
    stopActiveDragResize()
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    removeDragResizeListeners = null
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  removeDragResizeListeners = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    removeDragResizeListeners = null
  }
}

function startDragWindow(event: MouseEvent) {
  if (event.button !== 0) return
  if (resizingEdge) {
    resizingEdge = null
    void window.electronAPI.window.resizeEnd()
  }
  setMousePassthrough(false)
  draggingWindow = true
  void window.electronAPI.window.dragBegin(event.screenX, event.screenY)
  bindDragResizeListeners()
}

function startResizeWindow(
  edge: 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
  event: MouseEvent
) {
  if (event.button !== 0) return
  if (draggingWindow) {
    draggingWindow = false
    void window.electronAPI.window.dragEnd()
  }
  setMousePassthrough(false)
  resizingEdge = edge
  void window.electronAPI.window.resizeBegin(edge, event.screenX, event.screenY)
  bindDragResizeListeners()
}

function handleWindowBlur() {
  stopActiveDragResize()
  setMousePassthrough(true)
}

watch(
  () => configStore.config.live2dActionMap,
  () => {
    syncActionOptionsFromConfig()
  },
  { deep: true }
)

onMounted(async () => {
  if (!canvasRef.value) return

  logLive2D('info', 'Live2D 页面挂载')
  document.body.classList.add('live2d-page')
  setMousePassthrough(true)

  pixiApp = new PIXI.Application({
    view: canvasRef.value,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resizeTo: window,
  })
  patchRendererInteractionManager('after-pixi-init')

  await configStore.loadConfig()
  applyBehavior(configStore.config.live2dBehavior, 'initial-config')
  syncActionOptionsFromConfig()
  await ensureLive2DRuntime()
  if (configStore.config.live2dModelPath) {
    await loadModel(configStore.config.live2dModelPath)
  } else {
    logLive2D('warn', 'Live2D 页面启动时未配置模型路径')
  }

  idleTicker = (delta: number) => {
    if (!currentModel) return
    const behavior = behaviorState.value
    if (behavior?.enableIdleSway) {
      swayTime += delta / 60
      const speed = Math.max(0.1, behavior.idleSwaySpeed || 0.8)
      const amplitude = Math.max(0, behavior.idleSwayAmplitude || 0)
      currentModel.x = baseX + Math.sin(swayTime * speed) * amplitude
      currentModel.rotation = baseRotation + Math.sin(swayTime * speed * 0.7) * 0.01
    } else {
      currentModel.x = baseX
      currentModel.rotation = baseRotation
    }

    if (behavior?.enableEyeTracking) {
      const lerp = trackingMouseInside ? 0.24 : 0.12
      focusCurrentX += (focusTargetX - focusCurrentX) * lerp
      focusCurrentY += (focusTargetY - focusCurrentY) * lerp
      currentModel.focus(focusCurrentX, focusCurrentY)
    }
  }
  pixiApp.ticker.add(idleTicker)

  const offAction = window.electronAPI.live2d.onAction((action: Live2DAction) => {
    void performAction(action)
  })
  const offLoadModel = window.electronAPI.live2d.onLoadModel((modelPath: string) => {
    logLive2D('info', `收到 Live2D 切换模型事件: ${modelPath}`)
    void configStore.loadConfig().then(() => {
      applyBehavior(configStore.config.live2dBehavior, 'reload-on-model-change')
      syncActionOptionsFromConfig()
      return loadModel(modelPath)
    })
  })
  const offShowReply = window.electronAPI.live2d.onShowReply((text: string) => {
    showReply(text)
  })
  const offBehaviorUpdate = window.electronAPI.live2d.onBehaviorUpdate((behavior: {
    enableIdleSway: boolean
    idleSwayAmplitude: number
    idleSwaySpeed: number
    enableEyeTracking: boolean
  }) => {
    applyBehavior(behavior, 'ipc')
  })
  cleanups.push(offAction, offLoadModel, offShowReply, offBehaviorUpdate)

  window.addEventListener('resize', handleResize)
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseleave', handleMouseLeave)
  window.addEventListener('blur', handleWindowBlur)
  cleanups.push(() => window.removeEventListener('resize', handleResize))
  cleanups.push(() => window.removeEventListener('mousemove', handleMouseMove))
  cleanups.push(() => window.removeEventListener('mouseleave', handleMouseLeave))
  cleanups.push(() => window.removeEventListener('blur', handleWindowBlur))
})

onBeforeUnmount(() => {
  document.body.classList.remove('live2d-page')

  for (const off of cleanups) off()

  if (pixiApp && idleTicker) {
    pixiApp.ticker.remove(idleTicker)
    idleTicker = null
  }

  destroyCurrentModelSafely('beforeUnmount')

  if (pixiApp) {
    pixiApp.destroy(true)
    pixiApp = null
  }

  stopActiveDragResize()
  if (removeDragResizeListeners) {
    removeDragResizeListeners()
  }
  setMousePassthrough(false)

  if (replyTimer) clearTimeout(replyTimer)
})
</script>

<style scoped>
.live2d-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  -webkit-app-region: no-drag;
}

.drag-bar {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 34px;
  z-index: 900;
  -webkit-app-region: no-drag;
  cursor: move;
}

canvas {
  width: 100%;
  height: 100%;
  display: block;
  -webkit-app-region: no-drag;
}

.reply-bubble {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 90%;
  z-index: 100;
  animation: fadeIn 0.3s ease;
  -webkit-app-region: no-drag;
}

.reply-content {
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 14px;
  padding: 10px 14px;
  font-size: 13px;
  color: #303133;
  line-height: 1.5;
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.18);
  max-height: 120px;
  overflow-y: auto;
  word-break: break-word;
}

.control-toggle {
  position: absolute;
  right: 10px;
  top: 40px;
  z-index: 940;
  -webkit-app-region: no-drag;
}

.control-toggle-btn {
  border: 1px solid rgba(15, 23, 42, 0.22);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}

.control-panel {
  position: absolute;
  right: 10px;
  top: 72px;
  z-index: 940;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(15, 23, 42, 0.2);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.18);
  -webkit-app-region: no-drag;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.control-row select {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  padding: 4px 6px;
  border: 1px solid rgba(15, 23, 42, 0.2);
  border-radius: 8px;
}

.control-row button {
  font-size: 12px;
  padding: 4px 8px;
  border: 1px solid rgba(15, 118, 110, 0.35);
  background: rgba(15, 118, 110, 0.1);
  color: #0f766e;
  border-radius: 8px;
  cursor: pointer;
}

.resize-handle {
  position: absolute;
  z-index: 980;
  -webkit-app-region: no-drag;
}

.resize-handle.top,
.resize-handle.bottom {
  left: 10px;
  right: 10px;
  height: 6px;
}

.resize-handle.left,
.resize-handle.right {
  top: 10px;
  bottom: 10px;
  width: 6px;
}

.resize-handle.top {
  top: 0;
  cursor: ns-resize;
}

.resize-handle.right {
  right: 0;
  cursor: ew-resize;
}

.resize-handle.bottom {
  bottom: 0;
  cursor: ns-resize;
}

.resize-handle.left {
  left: 0;
  cursor: ew-resize;
}

.resize-handle.top-left,
.resize-handle.top-right,
.resize-handle.bottom-left,
.resize-handle.bottom-right {
  width: 10px;
  height: 10px;
}

.resize-handle.top-left {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}

.resize-handle.top-right {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}

.resize-handle.bottom-left {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
}

.resize-handle.bottom-right {
  bottom: 0;
  right: 0;
  cursor: nwse-resize;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

</style>
