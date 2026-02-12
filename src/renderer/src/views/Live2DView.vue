<template>
  <div class="live2d-container">
    <div class="drag-bar" @click.stop />
    <canvas ref="canvasRef" @click="handleClick" />

    <div v-if="replyText" class="reply-bubble" @click.stop>
      <div class="reply-content">{{ replyText }}</div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as PIXI from 'pixi.js'
import cubismCoreRuntimeUrl from 'live2dcubismcore/live2dcubismcore.min.js?url'
import type { Live2DModel as Live2DModelType } from 'pixi-live2d-display/cubism4'
import type { Live2DAction } from '../../../common/types'
import { useConfigStore } from '../stores/config'

const canvasRef = ref<HTMLCanvasElement>()
const replyText = ref('')

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

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const stack = error.stack?.split('\n').slice(0, 2).join(' > ')
    return stack ? `${error.message} | ${stack}` : error.message
  }
  return String(error)
}

function logLive2D(level: 'info' | 'warn' | 'error', message: string) {
  void window.electronAPI.app.log.add(level, message, 'live2d')
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
  if (reason !== 'resize') {
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
    if (currentModel) {
      pixiApp.stage.removeChild(currentModel as any)
      currentModel.destroy()
      currentModel = null
    }

    let model: Live2DModelType | null = null
    const attemptErrors: string[] = []
    for (const url of urls) {
      const probeStart = performance.now()
      try {
        const response = await fetch(url, { cache: 'no-store' })
        const elapsed = (performance.now() - probeStart).toFixed(1)
        if (response.ok) {
          logLive2D(
            'info',
            `Live2D 模型探测成功: ${url} | status=${response.status} | cost=${elapsed}ms`
          )
        } else {
          logLive2D(
            'warn',
            `Live2D 模型探测返回非2xx: ${url} | status=${response.status} | cost=${elapsed}ms`
          )
        }
      } catch (probeError) {
        logLive2D('warn', `Live2D 模型探测失败: ${url} | ${describeError(probeError)}`)
      }

      try {
        model = await live2DModelCtor.from(url)
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

function resolveMappedActionName(action: Live2DAction): string {
  const map = configStore.config.live2dActionMap
  if (!map) return action.name

  if (action.type === 'expression') {
    return map.expression[action.name] || action.name
  }

  if (action.type === 'motion') {
    return map.motion[action.name] || action.name
  }

  return action.name
}

async function performAction(action: Live2DAction) {
  if (!currentModel) return

  try {
    if (action.type === 'expression') {
      await currentModel.expression(resolveMappedActionName(action))
      return
    }

    if (action.type === 'motion') {
      const priority = action.priority === 3 ? motionPriorityForce : motionPriorityNormal
      await currentModel.motion(resolveMappedActionName(action), undefined, priority)
      return
    }
  } catch (error) {
    logLive2D('warn', `Live2D 动作执行失败: ${JSON.stringify(action)} | ${describeError(error)}`)
    console.warn('[Live2D] 动作执行失败:', error)
  }
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
}

function handleMouseMove(event: MouseEvent) {
  if (!currentModel) return
  if (configStore.config.live2dBehavior?.enableEyeTracking) {
    currentModel.focus(event.clientX, event.clientY)
  }
}

function handleClick(event: MouseEvent) {
  window.electronAPI.trigger.invoke({ trigger: 'click_avatar' })
  if (currentModel) {
    currentModel.tap(event.clientX, event.clientY)
  }
}

onMounted(async () => {
  if (!canvasRef.value) return

  logLive2D('info', 'Live2D 页面挂载')
  document.body.classList.add('live2d-page')

  pixiApp = new PIXI.Application({
    view: canvasRef.value,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resizeTo: window,
  })

  await configStore.loadConfig()
  await ensureLive2DRuntime()
  if (configStore.config.live2dModelPath) {
    await loadModel(configStore.config.live2dModelPath)
  } else {
    logLive2D('warn', 'Live2D 页面启动时未配置模型路径')
  }

  idleTicker = (delta: number) => {
    if (!currentModel) return
    const behavior = configStore.config.live2dBehavior
    if (!behavior?.enableIdleSway) return

    swayTime += delta / 60
    const speed = Math.max(0.1, behavior.idleSwaySpeed || 0.8)
    const amplitude = Math.max(0, behavior.idleSwayAmplitude || 0)
    currentModel.x = baseX + Math.sin(swayTime * speed) * amplitude
    currentModel.rotation = baseRotation + Math.sin(swayTime * speed * 0.7) * 0.01
  }
  pixiApp.ticker.add(idleTicker)

  const offAction = window.electronAPI.live2d.onAction((action: Live2DAction) => {
    performAction(action)
  })
  const offLoadModel = window.electronAPI.live2d.onLoadModel((modelPath: string) => {
    logLive2D('info', `收到 Live2D 切换模型事件: ${modelPath}`)
    loadModel(modelPath)
  })
  const offShowReply = window.electronAPI.live2d.onShowReply((text: string) => {
    showReply(text)
  })
  cleanups.push(offAction, offLoadModel, offShowReply)

  window.addEventListener('resize', handleResize)
  window.addEventListener('mousemove', handleMouseMove)
  cleanups.push(() => window.removeEventListener('resize', handleResize))
  cleanups.push(() => window.removeEventListener('mousemove', handleMouseMove))
})

onBeforeUnmount(() => {
  document.body.classList.remove('live2d-page')

  for (const off of cleanups) off()

  if (pixiApp && idleTicker) {
    pixiApp.ticker.remove(idleTicker)
    idleTicker = null
  }

  if (currentModel && pixiApp) {
    pixiApp.stage.removeChild(currentModel as any)
    currentModel.destroy()
    currentModel = null
  }

  if (pixiApp) {
    pixiApp.destroy(true)
    pixiApp = null
  }

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
  -webkit-app-region: drag;
}

.drag-bar {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 34px;
  z-index: 900;
  -webkit-app-region: drag;
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
