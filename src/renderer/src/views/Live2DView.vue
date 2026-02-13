<template>
  <div class="live2d-container">
    <canvas
      ref="canvasRef"
      @click="handleClick"
      @mousedown.stop="startModelDrag"
      @wheel.prevent="handleModelWheel"
    />

    <div v-if="replyText" class="reply-bubble" @click.stop>
      <div class="reply-content">{{ replyText }}</div>
    </div>

    <div
      v-if="controlsState.visible"
      class="control-widget"
      :class="{ dragging: controlDragging }"
      :style="controlWidgetStyle"
      @click.stop
      @mousedown.stop
    >
      <div class="control-toolbar" @mousedown.stop.prevent="startControlDrag">
        <div class="control-toolbar-actions">
          <button type="button" class="control-toggle-btn" @click.stop="toggleControlPanel">
            {{ showControlPanel ? '收起' : '动作' }}
          </button>
          <button type="button" class="control-hide-btn" @click.stop="toggleControlButtonsVisible(false)">
            隐藏
          </button>
        </div>
      </div>

      <div v-if="showControlPanel" class="control-panel">
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
    </div>

    <div
      v-else
      class="control-restore"
      :class="{ dragging: controlDragging }"
      :style="controlWidgetStyle"
      @click.stop
      @mousedown.stop.prevent="startControlDrag"
    >
      <button
        type="button"
        class="control-show-btn"
        @mousedown.stop
        @click.stop="toggleControlButtonsVisible(true)"
      >
        显示按钮
      </button>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
const controlsState = ref({
  visible: true,
  x: 16,
  y: 40,
})
const controlDragging = ref(false)
const controlWidgetStyle = computed(() => ({
  left: `${controlsState.value.x}px`,
  top: `${controlsState.value.y}px`,
}))

const configStore = useConfigStore()
const cleanups: Array<() => void> = []

let pixiApp: PIXI.Application | null = null
let currentModel: Live2DModelType | null = null
let replyTimer: ReturnType<typeof setTimeout> | null = null
let idleTicker: ((delta: number) => void) | null = null
let baseX = 0
let baseY = 0
let baseRotation = 0
let swayTime = 0
let live2DModelCtor: typeof import('pixi-live2d-display/cubism4').Live2DModel | null = null
let cubism4Module: typeof import('pixi-live2d-display/cubism4') | null = null
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
let modelDragging = false
let modelDragMoved = false
let modelDragOffsetX = 0
let modelDragOffsetY = 0
let controlDragOffsetX = 0
let controlDragOffsetY = 0
let controlSaveTimer: ReturnType<typeof setTimeout> | null = null
let modelTransformSaveTimer: ReturnType<typeof setTimeout> | null = null
let modelTransformCustomized = false
let currentModelPath = ''
let lastScaleLogAt = 0
let lastInteractionState = ''
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

function clampControlPosition(x: number, y: number): { x: number; y: number } {
  const min = 8
  const maxX = Math.max(min, window.innerWidth - 56)
  const maxY = Math.max(min, window.innerHeight - 56)
  return {
    x: Math.min(maxX, Math.max(min, Math.round(x))),
    y: Math.min(maxY, Math.max(min, Math.round(y))),
  }
}

function sanitizeControls(input: any) {
  const defaultX = Math.max(16, window.innerWidth - 140)
  const x = Number(input?.x)
  const y = Number(input?.y)
  const next = clampControlPosition(Number.isFinite(x) ? x : defaultX, Number.isFinite(y) ? y : 40)
  return {
    visible: input?.visible !== false,
    x: next.x,
    y: next.y,
  }
}

function applyControls(input: any, source: string) {
  const next = sanitizeControls(input)
  const prev = controlsState.value
  controlsState.value = next
  if (!next.visible) {
    showControlPanel.value = false
  }
  if (prev.visible !== next.visible || prev.x !== next.x || prev.y !== next.y) {
    logLive2D(
      'info',
      `Live2D 功能按钮参数已更新: source=${source}, visible=${next.visible}, x=${next.x}, y=${next.y}`
    )
  }
}

function queuePersistControls(reason: string) {
  if (controlSaveTimer) {
    clearTimeout(controlSaveTimer)
  }
  controlSaveTimer = setTimeout(() => {
    controlSaveTimer = null
    const payload = { ...controlsState.value }
    void configStore
      .setConfig('live2dControls', payload)
      .then(() => {
        logLive2D(
          'info',
          `Live2D 功能按钮位置已保存: reason=${reason}, visible=${payload.visible}, x=${payload.x}, y=${payload.y}`
        )
      })
      .catch((error) => {
        logLive2D('warn', `Live2D 功能按钮位置保存失败: reason=${reason} | ${describeError(error)}`)
      })
  }, 180)
}

function normalizeModelTransformKey(modelPath: string): string {
  return String(modelPath || '')
    .trim()
    .replace(/\\/g, '/')
    .toLowerCase()
}

function sanitizeModelTransform(input: any): { x: number; y: number; scale: number } | null {
  const x = Number(input?.x)
  const y = Number(input?.y)
  const scale = Number(input?.scale)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale)) return null
  return {
    x: Math.round(x),
    y: Math.round(y),
    scale: Math.min(6, Math.max(0.05, scale)),
  }
}

function resolveSavedModelTransform(modelPath: string): { x: number; y: number; scale: number } | null {
  const map = configStore.config.live2dModelTransforms || {}
  const normalized = normalizeModelTransformKey(modelPath)
  const raw = map[normalized] ?? map[modelPath]
  return sanitizeModelTransform(raw)
}

function applySavedModelTransform(model: Live2DModelType, transform: { x: number; y: number; scale: number }, reason: string) {
  model.anchor.set(0.5, 1)
  model.scale.set(transform.scale)
  model.x = transform.x
  model.y = transform.y
  baseX = model.x
  baseY = model.y
  baseRotation = model.rotation
  modelTransformCustomized = true
  clampModelWithinViewport()
  logLive2D(
    'info',
    `Live2D 模型布局恢复: reason=${reason}, scale=${transform.scale.toFixed(3)}, pos=(${transform.x.toFixed(1)},${transform.y.toFixed(1)})`
  )
}

function queuePersistModelTransform(reason: string) {
  if (!currentModel || !currentModelPath) return
  if (modelTransformSaveTimer) {
    clearTimeout(modelTransformSaveTimer)
  }
  modelTransformSaveTimer = setTimeout(() => {
    modelTransformSaveTimer = null
    if (!currentModel || !currentModelPath) return
    const key = normalizeModelTransformKey(currentModelPath)
    if (!key) return
    const scale = Number(currentModel.scale.x) || 1
    const payload = {
      x: Math.round(baseX),
      y: Math.round(baseY),
      scale: Math.min(6, Math.max(0.05, scale)),
    }
    const map = configStore.config.live2dModelTransforms || {}
    const prev = sanitizeModelTransform(map[key])
    if (prev && prev.x === payload.x && prev.y === payload.y && Math.abs(prev.scale - payload.scale) < 0.0005) {
      return
    }
    const nextMap = {
      ...map,
      [key]: payload,
    }
    void configStore
      .setConfig('live2dModelTransforms', nextMap)
      .then(() => {
        logLive2D(
          'info',
          `Live2D 模型布局已保存: reason=${reason}, model=${currentModelPath}, scale=${payload.scale.toFixed(3)}, pos=(${payload.x},${payload.y})`
        )
      })
      .catch((error) => {
        logLive2D('warn', `Live2D 模型布局保存失败: reason=${reason}, model=${currentModelPath} | ${describeError(error)}`)
      })
  }, 240)
}

function syncActionOptionsFromConfig() {
  const expMap = configStore.config.live2dActionMap?.expression || {}
  const motMap = configStore.config.live2dActionMap?.motion || {}
  const exp = new Set<string>()
  const mot = new Set<string>()
  for (const [alias, target] of Object.entries(expMap)) {
    if (alias) exp.add(alias)
    if (target) exp.add(target)
  }
  for (const [alias, target] of Object.entries(motMap)) {
    if (alias) mot.add(alias)
    if (target) mot.add(target)
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
    cubism4Module = module
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

type RuntimeExpressionDef = { Name: string; File: string }
type RuntimeMotionDef = { File: string }

function parseFileListContent(content: string): string[] {
  const lines = content.split(/\r?\n/)
  const result: string[] = []
  const dirStack: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line) continue
    const indentLength = rawLine.match(/^(\s*)/)?.[1]?.length || 0
    const depth = Math.floor(indentLength / 2)
    const dirMatch = line.match(/^\[DIR\]\s+(.+?)\/$/)
    if (dirMatch) {
      dirStack.length = depth
      dirStack[depth] = dirMatch[1]
      continue
    }
    if (!line.startsWith('[FILE] ')) continue
    const filePart = line.slice(7)
    const marker = filePart.lastIndexOf(' (')
    const fileName = (marker >= 0 ? filePart.slice(0, marker) : filePart).trim()
    if (!fileName) continue
    const segments = [...dirStack.slice(0, depth).filter(Boolean), fileName]
    result.push(segments.join('/'))
  }

  return result
}

async function discoverRuntimeActionDefinitions(modelPath: string): Promise<{
  expressions: RuntimeExpressionDef[]
  motions: Record<string, RuntimeMotionDef[]>
}> {
  const modelDir = modelPath.trim().replace(/\\/g, '/').replace(/\/[^/]+$/, '')
  if (!modelDir) {
    return { expressions: [], motions: {} }
  }

  try {
    const result = await window.electronAPI.file.list(modelDir, true)
    const content = typeof result?.content === 'string' ? result.content : ''
    if (!content || result?.isError) {
      logLive2D(
        'warn',
        `Live2D 动作定义扫描失败: dir=${modelDir}, isError=${Boolean(result?.isError)}, detail=${content || 'empty'}`
      )
      return { expressions: [], motions: {} }
    }

    const files = parseFileListContent(content)
    const expressionMap = new Map<string, RuntimeExpressionDef>()
    const motionList: RuntimeMotionDef[] = []
    for (const relativePath of files) {
      const normalized = relativePath.replace(/\\/g, '/')
      const fileName = normalized.split('/').pop() || normalized
      if (/\.exp3\.json$/i.test(fileName)) {
        const name = fileName.replace(/\.exp3\.json$/i, '')
        if (!expressionMap.has(name)) {
          expressionMap.set(name, { Name: name, File: normalized })
        }
      }
      if (/\.(motion3\.json|mtn)$/i.test(fileName)) {
        motionList.push({ File: normalized })
      }
    }
    const expressions = Array.from(expressionMap.values())
    const motions: Record<string, RuntimeMotionDef[]> = {}
    if (motionList.length > 0) {
      motions.Auto = motionList
    }

    logLive2D(
      'info',
      `Live2D 动作定义扫描完成: dir=${modelDir}, expression=${expressions.length}, motion=${motionList.length}, expSample=${expressions
        .slice(0, 6)
        .map((item) => item.Name)
        .join(', ') || '无'}`
    )
    return { expressions, motions }
  } catch (error) {
    logLive2D('warn', `Live2D 动作定义扫描异常: dir=${modelDir} | ${describeError(error)}`)
    return { expressions: [], motions: {} }
  }
}

async function ensureRuntimeActionManagers(model: Live2DModelType, modelPath: string): Promise<void> {
  const internal = (model as any)?.internalModel
  const motionManager = internal?.motionManager
  const settings = internal?.settings
  if (!internal || !motionManager || !settings) {
    logLive2D('warn', 'Live2D 动作定义补齐跳过: internal/motionManager/settings 不完整')
    return
  }

  const hasExpressionManager = Boolean(motionManager.expressionManager)
  const hasExpressionDefs = Array.isArray(settings.expressions) && settings.expressions.length > 0
  const hasMotionDefs = settings.motions && typeof settings.motions === 'object' && Object.keys(settings.motions).length > 0
  if (hasExpressionManager && hasExpressionDefs && hasMotionDefs) return

  const discovered = await discoverRuntimeActionDefinitions(modelPath)
  const patchedParts: string[] = []

  if (!hasExpressionDefs && discovered.expressions.length > 0) {
    settings.expressions = discovered.expressions
    patchedParts.push(`expressions=${discovered.expressions.length}`)
  }
  if (!hasMotionDefs && Object.keys(discovered.motions).length > 0) {
    settings.motions = discovered.motions
    patchedParts.push(
      `motions=${Object.values(discovered.motions).reduce((sum: number, list: RuntimeMotionDef[]) => sum + list.length, 0)}`
    )
  }

  if (!motionManager.expressionManager && Array.isArray(settings.expressions) && settings.expressions.length > 0) {
    const expressionManagerCtor = (cubism4Module as any)?.Cubism4ExpressionManager
    if (typeof expressionManagerCtor === 'function') {
      motionManager.expressionManager = new expressionManagerCtor(settings, {})
      patchedParts.push('expressionManager=created')
    } else {
      logLive2D('warn', 'Live2D 动作定义补齐失败: Cubism4ExpressionManager 不可用')
    }
  }

  if (motionManager.expressionManager && Array.isArray(settings.expressions)) {
    motionManager.expressionManager.definitions = settings.expressions
    if (!Array.isArray(motionManager.expressionManager.expressions)) {
      motionManager.expressionManager.expressions = []
    }
  }

  if (settings.motions && typeof settings.motions === 'object') {
    motionManager.definitions = settings.motions
    motionManager.motionGroups = motionManager.motionGroups || {}
    for (const groupName of Object.keys(settings.motions)) {
      if (!Array.isArray(motionManager.motionGroups[groupName])) {
        motionManager.motionGroups[groupName] = []
      }
    }
  }

  if (patchedParts.length > 0) {
    logLive2D('info', `Live2D 动作定义补齐完成: ${patchedParts.join(', ')}`)
  } else {
    logLive2D(
      'warn',
      `Live2D 动作定义未补齐: expressionDefs=${Array.isArray(settings.expressions) ? settings.expressions.length : 0}, motionGroups=${Object.keys(settings.motions || {}).length}`
    )
  }
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
  baseY = model.y
  baseRotation = model.rotation
  modelTransformCustomized = false
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
    currentModelPath = modelPath

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
    modelTransformCustomized = false
    await ensureRuntimeActionManagers(model, modelPath)
    const savedTransform = resolveSavedModelTransform(modelPath)
    if (savedTransform) {
      applySavedModelTransform(model, savedTransform, 'saved-transform')
    } else {
      fitModelWithRetry(model)
    }
    await playInitialMotion(model)
    const textureCount = Array.isArray((model as any).textures) ? (model as any).textures.length : 0
    const actionSnapshot = collectModelActionDebugSnapshot()
    logLive2D(
      'info',
      `Live2D 模型加载成功: ${modelPath} | texture=${textureCount}, motionGroup=${actionSnapshot.motionGroupCount}, expression=${actionSnapshot.expressionDefinitionCount}, expMgr=${actionSnapshot.hasExpressionManager}, expSample=${actionSnapshot.expressionSample}, motSample=${actionSnapshot.motionSample}`
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
  return input
}

function getExpressionDefinitions(): any[] {
  if (!currentModel) return []
  const viaMotionManager = (currentModel as any)?.internalModel?.motionManager?.expressionManager?.definitions
  if (Array.isArray(viaMotionManager)) return viaMotionManager
  const viaInternal = (currentModel as any)?.internalModel?.expressionManager?.definitions
  if (Array.isArray(viaInternal)) return viaInternal
  const viaSettings = (currentModel as any)?.internalModel?.settings?.expressions
  return Array.isArray(viaSettings) ? viaSettings : []
}

function getMotionDefinitions(): Record<string, any[]> {
  if (!currentModel) return {}
  const viaManager = (currentModel as any)?.internalModel?.motionManager?.definitions
  if (viaManager && typeof viaManager === 'object') {
    return viaManager
  }
  const viaSettings = (currentModel as any)?.internalModel?.settings?.motions
  if (viaSettings && typeof viaSettings === 'object') {
    return viaSettings
  }
  return {}
}

function collectModelActionDebugSnapshot() {
  const expressionDefs = getExpressionDefinitions()
  const motionDefs = getMotionDefinitions()
  const expressionManager = (currentModel as any)?.internalModel?.motionManager?.expressionManager
  return {
    expressionDefinitionCount: expressionDefs.length,
    motionGroupCount: Object.keys(motionDefs).length,
    hasExpressionManager: Boolean(expressionManager),
    expressionSample: expressionDefs
      .slice(0, 5)
      .map((item: any) =>
        String(
          typeof item === 'string'
            ? item
            : item?.Name || item?.name || item?.File || item?.file || ''
        ).trim()
      )
      .filter(Boolean)
      .join(', ') || '无',
    motionSample:
      Object.entries(motionDefs)
        .slice(0, 4)
        .map(([group, list]) => `${group}:${Array.isArray(list) ? list.length : 0}`)
        .join(', ') || '无',
  }
}

function collectAvailableActionNames(type: 'expression' | 'motion'): string[] {
  if (!currentModel) return []
  if (type === 'motion') {
    const defs = getMotionDefinitions()
    const names = new Set<string>()
    for (const [groupName, items] of Object.entries(defs)) {
      const group = String(groupName || '').trim()
      if (group) names.add(group)
      const list = Array.isArray(items) ? items : []
      for (const item of list) {
        const raw = String((item as any)?.File || (item as any)?.file || (item as any)?.Name || (item as any)?.name || '')
          .trim()
        if (!raw) continue
        names.add(raw)
        names.add(raw.replace(/\.(motion3\.json|json|mtn)$/i, ''))
      }
    }
    return Array.from(names)
  }

  const defs = getExpressionDefinitions()
  if (defs.length === 0) return []
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

function findExpressionIndexByName(name: string): number {
  if (!currentModel) return -1
  const defs = getExpressionDefinitions()
  if (defs.length === 0) return -1
  const normalized = normalizeActionToken(name)
  if (!normalized) return -1

  for (let i = 0; i < defs.length; i += 1) {
    const item = defs[i]
    const raw =
      typeof item === 'string'
        ? item
        : String(item?.Name || item?.name || item?.File || item?.file || '').trim()
    if (!raw) continue
    const variants = [raw, raw.replace(/\.(exp3\.json|json)$/i, '')]
    if (variants.some((token) => normalizeActionToken(token) === normalized)) {
      return i
    }
  }

  return -1
}

function resolveMotionFallback(name: string): { group: string; index?: number } | null {
  if (!currentModel) return null
  const defs = getMotionDefinitions()
  const entries = Object.entries(defs) as Array<[string, any[]]>
  if (entries.length === 0) return null

  const normalized = normalizeActionToken(name)
  if (!normalized) return null

  for (const [groupName] of entries) {
    const group = String(groupName || '').trim()
    if (!group) continue
    if (normalizeActionToken(group) === normalized) {
      return { group }
    }
  }

  for (const [groupName, items] of entries) {
    const group = String(groupName || '').trim()
    if (!group) continue
    const list = Array.isArray(items) ? items : []
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index]
      const raw = String(item?.File || item?.file || item?.Name || item?.name || '').trim()
      if (!raw) continue
      const variants = [raw, raw.replace(/\.(motion3\.json|json|mtn)$/i, '')]
      if (variants.some((token) => normalizeActionToken(token) === normalized)) {
        return { group, index }
      }
    }
  }

  return null
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
  if (!currentModel) {
    logLive2D('warn', `Live2D 动作执行被忽略: 模型未就绪 type=${action.type}, input=${action.name}`)
    return { ok: false, resolvedName: '' }
  }
  if (action.type !== 'expression' && action.type !== 'motion') {
    return { ok: false, resolvedName: action.name }
  }

  const mapped = resolveMappedActionName(action).trim()
  const original = action.name.trim()
  const available = collectAvailableActionNames(action.type)
  const modelSnapshot = collectModelActionDebugSnapshot()
  if (available.length === 0) {
    logLive2D(
      'warn',
      `Live2D 动作可用列表为空: type=${action.type}, input=${action.name}, mapped=${mapped || '空'}, modelDefs(expression=${modelSnapshot.expressionDefinitionCount},motionGroup=${modelSnapshot.motionGroupCount},expMgr=${modelSnapshot.hasExpressionManager}), expSample=${modelSnapshot.expressionSample}, motSample=${modelSnapshot.motionSample}`
    )
  }
  const primary = findBestAvailableName([mapped, original], available)
  const candidates = Array.from(new Set([primary, mapped, original].map((item) => item.trim()).filter(Boolean)))

  const executeByName = async (name: string): Promise<string> => {
    if (action.type === 'expression') {
      try {
        const okByName = await currentModel!.expression(name as any)
        if (okByName === true) {
          return name
        }
      } catch (error) {
        throw new Error(`expression(name) 抛错: ${describeError(error)}`)
      }
      const fallbackIndex = findExpressionIndexByName(name)
      if (fallbackIndex < 0) {
        throw new Error('expression(name) 返回 false，且未匹配到表达式索引')
      }
      const okByIndex = await currentModel!.expression(fallbackIndex as any)
      if (okByIndex === true) {
        return `${name}#${fallbackIndex}`
      }
      throw new Error(`expression(index=${fallbackIndex}) 返回 false`)
    }

    const priority = action.priority === 3 ? motionPriorityForce : motionPriorityNormal
    try {
      const okByName = await currentModel!.motion(name, undefined, priority)
      if (okByName === true) {
        return name
      }
    } catch (error) {
      throw new Error(`motion(name) 抛错: ${describeError(error)}`)
    }
    const fallback = resolveMotionFallback(name)
    if (!fallback) {
      throw new Error('motion(name) 返回 false，且未匹配到动作分组/索引')
    }
    const okByFallback = await currentModel!.motion(fallback.group, fallback.index, priority)
    if (okByFallback === true) {
      return typeof fallback.index === 'number' ? `${fallback.group}[${fallback.index}]` : fallback.group
    }
    throw new Error(`motion(fallback=${fallback.group}${typeof fallback.index === 'number' ? `[${fallback.index}]` : ''}) 返回 false`)
  }

  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const executed = await executeByName(candidate)
      return { ok: true, resolvedName: executed }
    } catch (error) {
      errors.push(`${candidate}: ${describeError(error)}`)
    }
  }

  const availableSample = available.slice(0, 8).join(', ') || '无'
  const mapSample =
    Object.entries(resolveActionMap(action.type))
      .slice(0, 6)
      .map(([alias, target]) => `${alias}->${target}`)
      .join(', ') || '无'
  logLive2D(
    'warn',
    `Live2D 动作执行失败: type=${action.type}, input=${action.name}, mapped=${mapped || '空'}, candidates=${candidates.join(', ') || '无'}, available=${availableSample}, mapSample=${mapSample}, errors=${errors.slice(0, 2).join(' | ') || '无'}`
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
  return Boolean(target.closest('.control-widget, .control-panel, .control-restore, .reply-bubble'))
}

function clampModelWithinViewport() {
  if (!currentModel) return
  try {
    const bounds = currentModel.getBounds()
    const minVisible = 36
    let offsetX = 0
    let offsetY = 0
    if (bounds.x + bounds.width < minVisible) {
      offsetX = minVisible - (bounds.x + bounds.width)
    } else if (bounds.x > window.innerWidth - minVisible) {
      offsetX = window.innerWidth - minVisible - bounds.x
    }
    if (bounds.y + bounds.height < minVisible) {
      offsetY = minVisible - (bounds.y + bounds.height)
    } else if (bounds.y > window.innerHeight - minVisible) {
      offsetY = window.innerHeight - minVisible - bounds.y
    }
    if (offsetX !== 0 || offsetY !== 0) {
      baseX += offsetX
      baseY += offsetY
      currentModel.x += offsetX
      currentModel.y += offsetY
    }
  } catch {
    // ignore invalid bounds during model init stage
  }
}

function updateMousePassthrough(clientX: number, clientY: number, target: EventTarget | null) {
  if (modelDragging || controlDragging.value) {
    setMousePassthrough(false)
    return
  }
  const element = target instanceof Element ? target : document.elementFromPoint(clientX, clientY)
  const onInteractiveElement = isPointerOnInteractiveElement(element)
  const onModel = isPointInsideModel(clientX, clientY)
  setMousePassthrough(!(onInteractiveElement || onModel))
}

function updateMousePassthroughByPointer(event: MouseEvent) {
  updateMousePassthrough(event.clientX, event.clientY, event.target)
}

function showReply(text: string) {
  if (replyTimer) clearTimeout(replyTimer)
  replyText.value = text
  replyTimer = setTimeout(() => {
    replyText.value = ''
  }, 10000)
}

function setControlPosition(x: number, y: number) {
  const next = clampControlPosition(x, y)
  controlsState.value = {
    ...controlsState.value,
    x: next.x,
    y: next.y,
  }
}

function startControlDrag(event: MouseEvent) {
  if (event.button !== 0) return
  const next = clampControlPosition(controlsState.value.x, controlsState.value.y)
  controlsState.value = {
    ...controlsState.value,
    x: next.x,
    y: next.y,
  }
  controlDragging.value = true
  controlDragOffsetX = event.clientX - controlsState.value.x
  controlDragOffsetY = event.clientY - controlsState.value.y
  setMousePassthrough(false)
}

function toggleControlButtonsVisible(visible: boolean) {
  if (controlsState.value.visible === visible) return
  controlsState.value = {
    ...controlsState.value,
    visible,
  }
  if (!visible) {
    showControlPanel.value = false
  }
  logLive2D('info', `Live2D 功能按钮可见性已切换: visible=${visible}`)
  if (lastPointerX > 0 || lastPointerY > 0) {
    updateMousePassthrough(lastPointerX, lastPointerY, null)
  }
  queuePersistControls('toggle-visible')
}

function handleResize() {
  if (!pixiApp) return
  pixiApp.renderer.resize(window.innerWidth, window.innerHeight)
  if (currentModel) {
    if (modelTransformCustomized) {
      clampModelWithinViewport()
      queuePersistModelTransform('resize')
    } else {
      fitModel(currentModel, 'resize')
    }
  }
  focusTargetX = window.innerWidth / 2
  focusTargetY = window.innerHeight * 0.45
  setControlPosition(controlsState.value.x, controlsState.value.y)
  if (lastPointerX > 0 || lastPointerY > 0) {
    updateMousePassthrough(lastPointerX, lastPointerY, null)
  }
}

function handleMouseMove(event: MouseEvent) {
  if (controlDragging.value && event.buttons === 0) {
    controlDragging.value = false
    queuePersistControls('drag-release')
  }
  if (controlDragging.value) {
    setControlPosition(event.clientX - controlDragOffsetX, event.clientY - controlDragOffsetY)
    updateMousePassthroughByPointer(event)
    return
  }
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  if (modelDragging && event.buttons === 0) {
    modelDragging = false
    queuePersistModelTransform('drag-release')
  }
  lastPointerX = event.clientX
  lastPointerY = event.clientY
  trackingMouseInside = true
  focusTargetX = Math.max(rect.left, Math.min(rect.right, event.clientX))
  focusTargetY = Math.max(rect.top, Math.min(rect.bottom, event.clientY))
  if (modelDragging && currentModel) {
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top
    const nextX = localX - modelDragOffsetX
    const nextY = localY - modelDragOffsetY
    if (Math.abs(nextX - baseX) + Math.abs(nextY - baseY) > 1.2) {
      modelDragMoved = true
    }
    baseX = nextX
    baseY = nextY
    currentModel.x = nextX
    currentModel.y = nextY
    modelTransformCustomized = true
    clampModelWithinViewport()
  }
  updateMousePassthroughByPointer(event)
}

function handleMouseLeave() {
  trackingMouseInside = false
  focusTargetX = window.innerWidth / 2
  focusTargetY = window.innerHeight * 0.45
  if (modelDragging || controlDragging.value) return
  setMousePassthrough(true)
}

function handleClick(event: MouseEvent) {
  if (modelDragMoved) {
    modelDragMoved = false
    return
  }
  if (!isPointInsideModel(event.clientX, event.clientY)) return
  window.electronAPI.trigger.invoke({ trigger: 'click_avatar' })
  if (currentModel) {
    currentModel.tap(event.clientX, event.clientY)
  }
}

function handleMouseUp(event: MouseEvent) {
  if (controlDragging.value) {
    controlDragging.value = false
    queuePersistControls('drag-end')
  }
  if (modelDragging) {
    modelDragging = false
    queuePersistModelTransform('drag-end')
  }
  updateMousePassthrough(event.clientX, event.clientY, event.target)
}

function startModelDrag(event: MouseEvent) {
  if (event.button !== 0) return
  if (!currentModel || !canvasRef.value) return
  if (!isPointInsideModel(event.clientX, event.clientY)) return
  const rect = canvasRef.value.getBoundingClientRect()
  const localX = event.clientX - rect.left
  const localY = event.clientY - rect.top
  modelDragging = true
  modelDragMoved = false
  modelDragOffsetX = localX - currentModel.x
  modelDragOffsetY = localY - currentModel.y
  setMousePassthrough(false)
}

function handleModelWheel(event: WheelEvent) {
  if (!currentModel) return
  if (!isPointInsideModel(event.clientX, event.clientY)) return
  const currentScale = Number(currentModel.scale.x) || 1
  const factor = Math.exp(-event.deltaY * 0.0015)
  const nextScale = Math.max(0.05, Math.min(6, currentScale * factor))
  if (!Number.isFinite(nextScale) || Math.abs(nextScale - currentScale) < 0.0005) return
  currentModel.scale.set(nextScale)
  modelTransformCustomized = true
  clampModelWithinViewport()
  queuePersistModelTransform('wheel-scale')
  setMousePassthrough(false)
  const now = Date.now()
  if (now - lastScaleLogAt > 320) {
    lastScaleLogAt = now
    logLive2D('info', `Live2D 模型缩放: scale=${nextScale.toFixed(3)}, deltaY=${event.deltaY.toFixed(1)}`)
  }
}

function toggleControlPanel() {
  if (!controlsState.value.visible) {
    controlsState.value = {
      ...controlsState.value,
      visible: true,
    }
    queuePersistControls('auto-show-panel')
  }
  showControlPanel.value = !showControlPanel.value
}

async function triggerExpressionManually() {
  const name = selectedExpression.value.trim()
  if (!name) return
  const mapped = resolveMappedActionName({ type: 'expression', name }).trim()
  const available = collectAvailableActionNames('expression')
  const mapSample =
    Object.entries(resolveActionMap('expression'))
      .slice(0, 6)
      .map(([alias, target]) => `${alias}->${target}`)
      .join(', ') || '无'
  logLive2D(
    'info',
    `Live2D 手动触发表情请求: input=${name}, mapped=${mapped || '空'}, options=${expressionOptions.value.length}, available=${available.length}, sample=${available.slice(0, 8).join(', ') || '无'}, mapSample=${mapSample}`
  )
  const result = await performAction({ type: 'expression', name })
  if (result.ok) {
    logLive2D('info', `Live2D 手动触发表情成功: ${name} => ${result.resolvedName}`)
  } else {
    logLive2D('warn', `Live2D 手动触发表情失败: ${name}, mapped=${mapped || '空'}`)
  }
}

async function triggerMotionManually() {
  const name = selectedMotion.value.trim()
  if (!name) return
  const mapped = resolveMappedActionName({ type: 'motion', name }).trim()
  const available = collectAvailableActionNames('motion')
  const mapSample =
    Object.entries(resolveActionMap('motion'))
      .slice(0, 6)
      .map(([alias, target]) => `${alias}->${target}`)
      .join(', ') || '无'
  logLive2D(
    'info',
    `Live2D 手动触发动作请求: input=${name}, mapped=${mapped || '空'}, options=${motionOptions.value.length}, available=${available.length}, sample=${available.slice(0, 8).join(', ') || '无'}, mapSample=${mapSample}`
  )
  const result = await performAction({ type: 'motion', name, priority: 3 })
  if (result.ok) {
    logLive2D('info', `Live2D 手动触发动作成功: ${name} => ${result.resolvedName}`)
  } else {
    logLive2D('warn', `Live2D 手动触发动作失败: ${name}, mapped=${mapped || '空'}`)
  }
}

function handleWindowBlur() {
  if (modelDragging) {
    queuePersistModelTransform('window-blur')
  }
  modelDragging = false
  if (controlDragging.value) {
    controlDragging.value = false
    queuePersistControls('window-blur')
  }
  setMousePassthrough(true)
}

watch(
  () => configStore.config.live2dActionMap,
  () => {
    syncActionOptionsFromConfig()
  },
  { deep: true }
)

watch(
  () => configStore.config.live2dControls,
  (value) => {
    applyControls(value, 'config-watch')
  },
  { deep: true }
)

onMounted(async () => {
  if (!canvasRef.value) return

  logLive2D('info', 'Live2D 页面挂载')
  document.documentElement.classList.add('live2d-page')
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
  applyControls(configStore.config.live2dControls, 'initial-config')
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
      currentModel.y = baseY
      currentModel.rotation = baseRotation + Math.sin(swayTime * speed * 0.7) * 0.01
    } else {
      currentModel.x = baseX
      currentModel.y = baseY
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
  const offControlsUpdate = window.electronAPI.live2d.onControlsUpdate((controls: {
    visible: boolean
    x: number
    y: number
  }) => {
    applyControls(controls, 'ipc')
  })
  cleanups.push(offAction, offLoadModel, offShowReply, offBehaviorUpdate, offControlsUpdate)

  window.addEventListener('resize', handleResize)
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
  window.addEventListener('mouseleave', handleMouseLeave)
  window.addEventListener('blur', handleWindowBlur)
  cleanups.push(() => window.removeEventListener('resize', handleResize))
  cleanups.push(() => window.removeEventListener('mousemove', handleMouseMove))
  cleanups.push(() => window.removeEventListener('mouseup', handleMouseUp))
  cleanups.push(() => window.removeEventListener('mouseleave', handleMouseLeave))
  cleanups.push(() => window.removeEventListener('blur', handleWindowBlur))
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('live2d-page')
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

  modelDragging = false
  controlDragging.value = false
  setMousePassthrough(false)

  if (controlSaveTimer) clearTimeout(controlSaveTimer)
  if (modelTransformSaveTimer) clearTimeout(modelTransformSaveTimer)
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

.control-widget {
  position: absolute;
  z-index: 940;
  width: 236px;
  -webkit-app-region: no-drag;
}

.control-widget.dragging {
  opacity: 0.92;
}

.control-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid rgba(15, 23, 42, 0.22);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.16);
  cursor: move;
  user-select: none;
}

.control-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.control-toggle-btn {
  border: 1px solid rgba(15, 23, 42, 0.22);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}

.control-hide-btn,
.control-show-btn {
  border: 1px solid rgba(15, 23, 42, 0.18);
  border-radius: 999px;
  background: rgba(241, 245, 249, 0.95);
  color: #334155;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}

.control-panel {
  margin-top: 8px;
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

.control-restore {
  position: absolute;
  z-index: 940;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid rgba(15, 23, 42, 0.22);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.16);
  -webkit-app-region: no-drag;
}

.control-restore.dragging {
  opacity: 0.92;
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
