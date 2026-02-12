<template>
  <div class="chat-window">
    <div class="title-bar">
      <span>{{ characterName }}</span>
      <div class="controls">
        <button type="button" class="icon-btn" @click="createConversation" title="新建会话">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
        <button type="button" class="icon-btn" @click="clearChat" title="清空当前会话">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
        <button type="button" class="icon-btn" @click="minimize" title="最小化">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
        <button type="button" class="icon-btn danger" @click="close" title="关闭">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    </div>

    <div class="toolbar">
      <div class="conversation-select-wrapper">
        <select v-model="chatStore.activeConversationId" @change="switchConversation" class="conversation-select">
          <option v-for="item in chatStore.conversations" :key="item.id" :value="item.id">
            {{ item.title }}
          </option>
        </select>
        <button type="button" class="icon-btn danger-text" @click="deleteConversation" :disabled="!chatStore.activeConversationId" title="删除会话">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>

      <div class="conversation-edit-wrapper">
        <input v-model="conversationTitle" placeholder="输入会话标题" class="title-input" />
        <button type="button" class="text-btn" @click="renameConversation" :disabled="!conversationTitle.trim()">重命名</button>
      </div>
    </div>

    <div class="chat-messages" ref="messagesContainer">
      <div v-for="msg in visibleMessages" :key="msg.id" class="chat-message" :class="msg.role">
        <div class="bubble">
          <div v-if="msg.role === 'assistant' && msg.inference?.model" class="model-tag">
            本次推理模型：{{ msg.inference.model }}（{{ msg.inference.taskType }}）
          </div>
          <div v-if="msg.role === 'tool'" class="tool-result">
            <span class="tool-label">工具结果</span>
            <pre>{{ msg.content }}</pre>
          </div>
          <template v-else>{{ msg.content }}</template>
        </div>
      </div>

      <div v-if="chatStore.isLoading" class="chat-message assistant">
        <div class="bubble loading-dots">
          <span>.</span><span>.</span><span>.</span>
        </div>
      </div>
    </div>

    <div class="chat-input-area">
      <textarea
        ref="inputRef"
        v-model="chatStore.currentInput"
        @keydown.enter.exact="handleSend"
        placeholder="输入消息...（Enter 发送，Shift+Enter 换行）"
        rows="1"
      />
      <button type="button" class="send-btn" @click="handleSend()" :disabled="chatStore.isLoading || !chatStore.currentInput.trim()">
        发送
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore } from '../stores/chat'
import { useConfigStore } from '../stores/config'
import type { InvokeContext } from '../../../common/types'
import { ElMessage } from 'element-plus'

const router = useRouter()
const chatStore = useChatStore()
const configStore = useConfigStore()

const messagesContainer = ref<HTMLElement>()
const inputRef = ref<HTMLTextAreaElement>()
const conversationTitle = ref('')

const characterName = computed(() => configStore.activeCharacter?.name || 'AI 助手')
const visibleMessages = computed(() => chatStore.messages.filter((m) => m.role !== 'system'))

watch(
  () => chatStore.activeConversation?.title,
  (title) => {
    conversationTitle.value = title || ''
  },
  { immediate: true }
)

onMounted(async () => {
  await configStore.loadConfig()
  await chatStore.initConversation()
  const api = window.electronAPI
  if (!api?.on?.triggerInvoke) {
    ElMessage.error('桌面桥接不可用，请通过桌面应用启动。')
    return
  }
  api.on.triggerInvoke((context: InvokeContext) => {
    chatStore.handleTrigger(context)
  })
})

watch(
  () => chatStore.messages.length,
  () => {
    nextTick(() => {
      if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
      }
    })
  }
)

function handleSend(e?: KeyboardEvent) {
  if (e && e.shiftKey) return
  e?.preventDefault()
  chatStore.sendMessage(chatStore.currentInput)
}

async function switchConversation() {
  if (!chatStore.activeConversationId) return
  await chatStore.loadConversation(chatStore.activeConversationId)
}

async function createConversation() {
  await chatStore.createConversation()
}

async function renameConversation() {
  await chatStore.renameConversation(conversationTitle.value)
}

async function deleteConversation() {
  if (!chatStore.activeConversationId) return
  await chatStore.deleteConversation(chatStore.activeConversationId)
}

function minimize() {
  const api = window.electronAPI
  if (!api?.window?.minimize) {
    ElMessage.error('窗口控制不可用')
    return
  }
  api.window.minimize()
}

function close() {
  const api = window.electronAPI
  if (!api?.window?.close) {
    ElMessage.error('窗口控制不可用')
    return
  }
  api.window.close()
}

function clearChat() {
  chatStore.clearMessages()
}

function backToHome() {
  router.push('/live2d')
}
</script>

<style scoped>
.chat-window {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: linear-gradient(180deg, rgba(252, 255, 255, 0.96), rgba(244, 248, 249, 0.98));
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.12);
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.16);
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 16px 12px;
}

.chat-message {
  margin-bottom: 10px;
  display: flex;
}

.chat-message.user {
  justify-content: flex-end;
}

.chat-message.assistant,
.chat-message.tool {
  justify-content: flex-start;
}

.bubble {
  max-width: 80%;
  padding: 10px 13px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.55;
  word-break: break-word;
  white-space: pre-wrap;
}

.chat-message.user .bubble {
  background: linear-gradient(135deg, #0f766e 0%, #0e6d64 55%, #0b5e58 100%);
  color: #fff;
  border-bottom-right-radius: 6px;
  box-shadow: 0 8px 20px rgba(15, 118, 110, 0.28);
}

.chat-message.assistant .bubble {
  background: rgba(255, 255, 255, 0.96);
  color: #1f2937;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-bottom-left-radius: 6px;
  box-shadow: 0 5px 14px rgba(15, 23, 42, 0.08);
}

.chat-message.tool .bubble {
  background: linear-gradient(180deg, #f8fafc, #f3f6f9);
  color: #606266;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-bottom-left-radius: 6px;
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(8px);
}

.conversation-select-wrapper,
.conversation-edit-wrapper {
  display: flex;
  gap: 8px;
  align-items: center;
}

.conversation-select {
  flex: 1;
  padding: 7px 11px;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 10px;
  font-size: 13px;
  outline: none;
  background-color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  transition: all 0.2s;
}

.conversation-select:focus {
  border-color: #0f766e;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.14);
}

.title-input {
  flex: 1;
  padding: 7px 11px;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 10px;
  font-size: 13px;
  outline: none;
  background-color: rgba(255, 255, 255, 0.9);
  transition: all 0.2s;
}

.title-input:focus {
  border-color: #0f766e;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.14);
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  color: #606266;
  transition: all 0.2s;
}

.icon-btn:hover:not(:disabled) {
  background-color: rgba(15, 118, 110, 0.11);
  color: #0f766e;
}

.icon-btn.danger-text:hover:not(:disabled) {
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.1);
}

.icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  color: #c0c4cc;
}

.text-btn {
  padding: 7px 12px;
  border: 1px solid rgba(15, 23, 42, 0.14);
  background-color: rgba(255, 255, 255, 0.9);
  border-radius: 10px;
  font-size: 13px;
  color: #334155;
  cursor: pointer;
  transition: all 0.2s;
}

.text-btn:hover:not(:disabled) {
  color: #0f766e;
  border-color: rgba(15, 118, 110, 0.3);
  background-color: #e8f8f5;
}

.text-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  background-color: #f5f7fa;
}

.title-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 9px 14px;
  background: linear-gradient(118deg, #0f766e 0%, #115e59 54%, #0b4f4a 100%);
  color: #fff;
  font-weight: 500;
  -webkit-app-region: drag;
  letter-spacing: 0.2px;
}

.title-bar .controls {
  display: flex;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.title-bar .controls .icon-btn {
  color: rgba(255, 255, 255, 0.9);
  padding: 4px;
  border-radius: 4px;
}

.title-bar .controls .icon-btn:hover {
  background-color: rgba(255, 255, 255, 0.24);
  color: #fff;
}

.title-bar .controls .icon-btn.danger:hover {
  background-color: #f56c6c;
}

.chat-input-area {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
  background-color: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(8px);
}

.chat-input-area textarea {
  flex: 1;
  resize: none;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 10px;
  padding: 9px 11px;
  font-family: inherit;
  font-size: 14px;
  transition: all 0.2s;
  outline: none;
}

.chat-input-area textarea:focus {
  border-color: #0f766e;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.15);
}

.send-btn {
  padding: 8px 18px;
  background: linear-gradient(135deg, #0f766e 0%, #0b5e58 100%);
  color: #fff;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
  transition: transform 0.2s, box-shadow 0.2s, filter 0.2s;
  box-shadow: 0 8px 18px rgba(15, 118, 110, 0.26);
}

.send-btn:hover:not(:disabled) {
  filter: brightness(1.04);
  transform: translateY(-1px);
}

.send-btn:disabled {
  background: #93c5c0;
  box-shadow: none;
  cursor: not-allowed;
}

.tool-result {
  font-size: 12px;
  margin-top: 4px;
}

.model-tag {
  font-size: 11px;
  color: #0f766e;
  background: #e8f8f5;
  border: 1px solid #bee9e3;
  border-radius: 8px;
  padding: 2px 6px;
  margin-bottom: 6px;
  display: inline-block;
}

.tool-result .tool-label {
  font-weight: 600;
  display: block;
  margin-bottom: 4px;
  color: #606266;
}

.tool-result pre {
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  font-size: 12px;
  background: rgba(226, 232, 240, 0.55);
  padding: 8px;
  border-radius: 8px;
  color: #606266;
  border: 1px solid rgba(15, 23, 42, 0.1);
}

.loading-dots span {
  animation: blink 1.4s infinite both;
  font-size: 18px;
  margin: 0 2px;
}

.loading-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.loading-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes blink {
  0%,
  80%,
  100% {
    opacity: 0.2;
  }

  40% {
    opacity: 1;
  }
}
</style>
