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
import { Application } from 'pixi.js'
import { Live2DModel, MotionPriority } from 'pixi-live2d-display'
import 'pixi-live2d-display/cubism2'
import 'pixi-live2d-display/cubism4'
import 'live2dcubismcore/live2dcubismcore.min.js'
import type { Live2DAction } from '../../../common/types'
import { useConfigStore } from '../stores/config'

const canvasRef = ref<HTMLCanvasElement>()
const replyText = ref('')

const configStore = useConfigStore()
const cleanups: Array<() => void> = []

let pixiApp: Application | null = null
let currentModel: Live2DModel | null = null
let replyTimer: ReturnType<typeof setTimeout> | null = null
let idleTicker: ((delta: number) => void) | null = null
let baseX = 0
let baseRotation = 0
let swayTime = 0

function toModelUrl(inputPath: string): string {
  const modelPath = inputPath.trim()
  if (!modelPath) return ''

  if (/^https?:\/\//i.test(modelPath) || /^file:\/\//i.test(modelPath)) {
    return modelPath
  }

  const normalized = modelPath.replace(/\\/g, '/')
  const segments = normalized.split('/').map((seg, i) => (i === 0 && /^[a-zA-Z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${segments.join('/')}`
  }
  return `file://${segments.join('/')}`
}

function fitModel(model: Live2DModel) {
  if (!pixiApp) return

  const stageWidth = window.innerWidth
  const stageHeight = window.innerHeight
  const modelWidth = Math.max(1, model.width)
  const modelHeight = Math.max(1, model.height)

  const scale = Math.min((stageWidth * 0.85) / modelWidth, (stageHeight * 0.9) / modelHeight)
  model.scale.set(scale)
  model.anchor.set(0.5, 1)
  model.x = stageWidth / 2
  model.y = stageHeight - 6
  baseX = model.x
  baseRotation = model.rotation
}

async function loadModel(modelPath: string) {
  if (!pixiApp || !modelPath) return

  const url = toModelUrl(modelPath)
  if (!url) return

  try {
    if (currentModel) {
      pixiApp.stage.removeChild(currentModel as any)
      currentModel.destroy()
      currentModel = null
    }

    const model = await Live2DModel.from(url)
    currentModel = model
    pixiApp.stage.addChild(model as any)
    fitModel(model)
    void window.electronAPI.app.log.add('info', `Live2D 模型加载成功: ${modelPath}`, 'live2d')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    void window.electronAPI.app.log.add('warn', `Live2D 模型加载异常详情: ${message}`, 'live2d')
    void window.electronAPI.app.log.add(
      'error',
      `Live2D 模型加载失败: ${modelPath} | ${message}`,
      'live2d'
    )
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
      const priority = action.priority === 3 ? MotionPriority.FORCE : MotionPriority.NORMAL
      await currentModel.motion(resolveMappedActionName(action), undefined, priority)
      return
    }
  } catch (error) {
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
  fitModel(currentModel)
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

  document.body.classList.add('live2d-page')

  pixiApp = new Application({
    view: canvasRef.value,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resizeTo: window,
  })

  await configStore.loadConfig()
  if (configStore.config.live2dModelPath) {
    await loadModel(configStore.config.live2dModelPath)
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
