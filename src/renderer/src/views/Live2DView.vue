<template>
  <div class="live2d-container" @click="handleClick">
    <canvas ref="canvasRef" />
    <div v-if="statusText && hasModel" class="status">{{ statusText }}</div>
    <div v-if="errorText" class="error">{{ errorText }}</div>

    <div v-if="replyText" class="reply-bubble" @click.stop>
      <div class="reply-content">{{ replyText }}</div>
    </div>

    <div class="app-icon-menu">
      <el-dropdown trigger="click" @command="handleCommand">
        <div class="app-icon" @click.stop>
          <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"></path>
            <path d="M12 6v6l4 2"></path>
          </svg>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="chat">打开对话</el-dropdown-item>
            <el-dropdown-item command="settings">设置中心</el-dropdown-item>
            <el-dropdown-item command="quit" divided>退出程序</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
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
const statusText = ref('')
const errorText = ref('')
const replyText = ref('')
const hasModel = ref(false)

const configStore = useConfigStore()
const cleanups: Array<() => void> = []

let pixiApp: Application | null = null
let currentModel: Live2DModel | null = null
let replyTimer: ReturnType<typeof setTimeout> | null = null
let idleTicker: ((delta: number) => void) | null = null
let baseX = 0
let baseRotation = 0
let swayTime = 0

function handleCommand(command: string) {
  if (command === 'chat') {
    window.electronAPI.window.toggleChat()
  } else if (command === 'settings') {
    window.electronAPI.window.openSettings()
  } else if (command === 'quit') {
    window.electronAPI.window.close()
  }
}

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
  baseX = model.x
  baseRotation = model.rotation
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
    hasModel.value = true
    statusText.value = ''
  } catch (error) {
    errorText.value = `模型加载失败: ${error instanceof Error ? error.message : String(error)}`
    statusText.value = ''
    hasModel.value = false
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
  cursor: pointer;
  background:
    radial-gradient(900px 420px at -8% -8%, rgba(15, 118, 110, 0.24), transparent 58%),
    radial-gradient(780px 360px at 112% 0%, rgba(217, 119, 6, 0.17), transparent 55%);
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
  background: rgba(15, 23, 42, 0.58);
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

.reply-bubble {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 90%;
  z-index: 100;
  animation: fadeIn 0.3s ease;
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

.app-icon-menu {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1000;
  -webkit-app-region: no-drag;
}

.app-icon {
  width: 32px;
  height: 32px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.88), rgba(235, 250, 248, 0.92));
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 8px 16px rgba(15, 23, 42, 0.2);
  transition: all 0.2s;
  color: #0f766e;
}

.app-icon:hover {
  background-color: #fff;
  transform: scale(1.1);
  box-shadow: 0 12px 22px rgba(15, 23, 42, 0.24);
}
</style>
