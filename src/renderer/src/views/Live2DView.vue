<template>
  <div class="live2d-container" @click="handleClick">
    <canvas ref="canvasRef" />
    <div class="status" v-if="statusText">{{ statusText }}</div>
    <div class="error" v-if="errorText">{{ errorText }}</div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Application } from 'pixi.js'
import { Live2DModel, MotionPriority } from 'pixi-live2d-display/cubism4'
import 'live2dcubismcore/live2dcubismcore.min.js'
import type { Live2DAction } from '../../../common/types'
import { useConfigStore } from '../stores/config'

const canvasRef = ref<HTMLCanvasElement>()
const statusText = ref('')
const errorText = ref('')

const configStore = useConfigStore()
const cleanups: Array<() => void> = []

let pixiApp: Application | null = null
let currentModel: Live2DModel | null = null

function toModelUrl(inputPath: string): string {
  const modelPath = inputPath.trim()
  if (!modelPath) return ''
  if (/^https?:\/\//i.test(modelPath) || /^file:\/\//i.test(modelPath)) {
    return modelPath
  }
  if (/^[a-zA-Z]:\\/.test(modelPath)) {
    const normalized = modelPath.replace(/\\/g, '/')
    return encodeURI(`file:///${normalized}`)
  }
  return encodeURI(`file://${modelPath.replace(/\\/g, '/')}`)
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
}

async function loadModel(modelPath: string) {
  if (!pixiApp || !modelPath) return
  const url = toModelUrl(modelPath)
  if (!url) return

  statusText.value = '正在加载 Live2D 模型...'
  errorText.value = ''

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
    statusText.value = '模型加载成功'
  } catch (error) {
    errorText.value = `模型加载失败: ${error instanceof Error ? error.message : String(error)}`
    statusText.value = ''
  }
}

async function performAction(action: Live2DAction) {
  if (!currentModel) return

  try {
    if (action.type === 'expression') {
      await currentModel.expression(action.name)
      return
    }

    if (action.type === 'motion') {
      const priority = action.priority === 3 ? MotionPriority.FORCE : MotionPriority.NORMAL
      await currentModel.motion(action.name, undefined, priority)
      return
    }
  } catch (error) {
    console.warn('[Live2D] 动作执行失败:', error)
  }
}

function handleResize() {
  if (!pixiApp || !currentModel) return
  pixiApp.renderer.resize(window.innerWidth, window.innerHeight)
  fitModel(currentModel)
}

function handleClick(event: MouseEvent) {
  window.electronAPI.window.toggleChat()
  if (currentModel) {
    currentModel.tap(event.clientX, event.clientY)
  }
}

onMounted(async () => {
  if (!canvasRef.value) return

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
  } else {
    statusText.value = '请在设置页选择 .model3.json 模型文件'
  }

  const offAction = window.electronAPI.live2d.onAction((action: Live2DAction) => {
    performAction(action)
  })
  const offLoadModel = window.electronAPI.live2d.onLoadModel((modelPath: string) => {
    loadModel(modelPath)
  })
  cleanups.push(offAction, offLoadModel)

  window.addEventListener('resize', handleResize)
  cleanups.push(() => window.removeEventListener('resize', handleResize))
})

onBeforeUnmount(() => {
  for (const off of cleanups) off()
  if (currentModel && pixiApp) {
    pixiApp.stage.removeChild(currentModel as any)
    currentModel.destroy()
    currentModel = null
  }
  if (pixiApp) {
    pixiApp.destroy(true)
    pixiApp = null
  }
})
</script>

<style scoped>
.live2d-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  cursor: pointer;
}

canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.status {
  position: absolute;
  left: 10px;
  bottom: 10px;
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
}

.error {
  position: absolute;
  left: 10px;
  top: 10px;
  max-width: 90%;
  color: #fff;
  background: rgba(176, 38, 38, 0.88);
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
