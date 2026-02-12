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
  background-color: #f5f7fa;
  border-radius: 8px;
  overflow: hidden;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.chat-message {
  margin-bottom: 12px;
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
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
}

.chat-message.user .bubble {
  background-color: #409eff;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.chat-message.assistant .bubble {
  background-color: #fff;
  color: #303133;
  border: 1px solid #ebeef5;
  border-bottom-left-radius: 4px;
}

.chat-message.tool .bubble {
  background-color: #fafafa;
  color: #606266;
  border: 1px solid #ebeef5;
  border-bottom-left-radius: 4px;
}

.chat-input-area {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #ebeef5;
  background-color: #fff;
}

.chat-input-area textarea {
  flex: 1;
  resize: none;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 14px;
  transition: border-color 0.2s;
  outline: none;
}

.chat-input-area textarea:focus {
  border-color: #409eff;
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background-color: #fff;
}

.conversation-select-wrapper,
.conversation-edit-wrapper {
  display: flex;
  gap: 8px;
  align-items: center;
}

.conversation-select {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 13px;
  outline: none;
  background-color: #fff;
  cursor: pointer;
}

.conversation-select:focus {
  border-color: #409eff;
}

.title-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 13px;
  outline: none;
}

.title-input:focus {
  border-color: #409eff;
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
  background-color: rgba(0, 0, 0, 0.05);
  color: #409eff;
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
  padding: 6px 12px;
  border: 1px solid #dcdfe6;
  background-color: #fff;
  border-radius: 4px;
  font-size: 13px;
  color: #606266;
  cursor: pointer;
  transition: all 0.2s;
}

.text-btn:hover:not(:disabled) {
  color: #409eff;
  border-color: #c6e2ff;
  background-color: #ecf5ff;
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
  padding: 10px 16px;
  background: linear-gradient(90deg, #409eff, #3a8ee6);
  color: #fff;
  font-weight: 500;
  -webkit-app-region: drag;
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
  background-color: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.title-bar .controls .icon-btn.danger:hover {
  background-color: #f56c6c;
}

.chat-input-area {
  padding: 12px 16px;
  border-top: 1px solid #ebeef5;
  background-color: #fff;
}

.chat-input-area textarea {
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 8px 10px;
  font-family: inherit;
  transition: border-color 0.2s;
}

.chat-input-area textarea:focus {
  border-color: #409eff;
}

.send-btn {
  padding: 8px 20px;
  background-color: #409eff;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s;
}

.send-btn:hover:not(:disabled) {
  background-color: #66b1ff;
}

.send-btn:disabled {
  background-color: #a0cfff;
  cursor: not-allowed;
}

.tool-result {
  font-size: 12px;
  margin-top: 4px;
}

.model-tag {
  font-size: 11px;
  color: #409eff;
  background: #ecf5ff;
  border: 1px solid #d9ecff;
  border-radius: 4px;
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
  background: #f5f7fa;
  padding: 8px;
  border-radius: 4px;
  color: #606266;
  border: 1px solid #ebeef5;
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
