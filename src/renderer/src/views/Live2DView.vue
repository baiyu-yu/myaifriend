<template>
  <div class="live2d-container" @click="handleClick">
    <canvas ref="canvasRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import type { InvokeContext, Live2DAction } from '../../../common/types'

const canvasRef = ref<HTMLCanvasElement>()
let model: unknown = null
const cleanups: Array<() => void> = []

onMounted(() => {
  initCanvas()
  setupLive2DListeners()

  const offTrigger = window.electronAPI.on.triggerInvoke((context: InvokeContext) => {
    if (context.trigger === 'click_avatar') {
      // 预留：后续可在这里处理点击角色时的特定行为。
    }
  })
  cleanups.push(offTrigger)
})

function initCanvas() {
  if (!canvasRef.value) return
  const canvas = canvasRef.value
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.fillStyle = 'rgba(100, 100, 200, 0.3)'
  ctx.beginPath()
  ctx.arc(canvas.width / 2, canvas.height / 2, 80, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#666'
  ctx.font = '14px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Live2D Placeholder Area', canvas.width / 2, canvas.height / 2 + 4)
}

function setupLive2DListeners() {
  const offAction = window.electronAPI.live2d.onAction((action: Live2DAction) => {
    performAction(action)
  })
  const offLoadModel = window.electronAPI.live2d.onLoadModel((modelPath: string) => {
    // 预留：后续在这里接入真实模型加载逻辑。
    console.log('[Live2D] load model:', modelPath)
  })

  cleanups.push(offAction, offLoadModel)
}

function handleClick() {
  window.electronAPI.window.toggleChat()
}

function performAction(action: Live2DAction) {
  if (!model) return

  switch (action.type) {
    case 'expression':
      console.log(`[Live2D] expression: ${action.name}`)
      break
    case 'motion':
      console.log(`[Live2D] motion: ${action.name}, priority: ${action.priority}`)
      break
    case 'speak':
      console.log(`[Live2D] speak: ${action.name}`)
      break
  }
}

onBeforeUnmount(() => {
  for (const off of cleanups) off()
})
</script>

<style scoped>
.live2d-container {
  cursor: pointer;
}

canvas {
  width: 100%;
  height: 100%;
}
</style>
