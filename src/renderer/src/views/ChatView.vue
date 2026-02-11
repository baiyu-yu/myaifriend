<template>
  <div class="chat-window">
    <div class="title-bar">
      <span>{{ characterName }}</span>
      <div class="controls">
        <button type="button" @click="createConversation" title="新建会话">新建</button>
        <button type="button" @click="clearChat" title="清空当前会话">清空</button>
        <button type="button" @click="minimize" title="最小化">-</button>
        <button type="button" @click="close" title="关闭">X</button>
      </div>
    </div>

    <div class="conversation-bar">
      <select v-model="chatStore.activeConversationId" @change="switchConversation">
        <option v-for="item in chatStore.conversations" :key="item.id" :value="item.id">
          {{ item.title }}
        </option>
      </select>
      <button type="button" class="danger" @click="deleteConversation" :disabled="!chatStore.activeConversationId">删除</button>
    </div>

    <div class="conversation-bar">
      <input v-model="conversationTitle" placeholder="输入会话标题" />
      <button type="button" @click="renameConversation" :disabled="!conversationTitle.trim()">重命名</button>
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
      <button type="button" @click="handleSend()" :disabled="chatStore.isLoading || !chatStore.currentInput.trim()">
        发送
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import { useConfigStore } from '../stores/config'
import type { InvokeContext } from '../../../common/types'

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
  window.electronAPI.on.triggerInvoke((context: InvokeContext) => {
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
  window.electronAPI.window.minimize()
}

function close() {
  window.electronAPI.window.close()
}

function clearChat() {
  chatStore.clearMessages()
}
</script>

<style scoped>
.conversation-bar {
  display: flex;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.conversation-bar select,
.conversation-bar input {
  flex: 1;
}

.danger {
  color: #fff;
  background: #d9534f;
  border: none;
  padding: 0 10px;
  border-radius: 4px;
}

.conversation-bar button:disabled,
.danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tool-result {
  font-size: 12px;
}

.model-tag {
  font-size: 11px;
  color: #5f6368;
  background: rgba(64, 158, 255, 0.12);
  border: 1px solid rgba(64, 158, 255, 0.25);
  border-radius: 10px;
  padding: 2px 8px;
  margin-bottom: 6px;
  display: inline-block;
}

.tool-result .tool-label {
  font-weight: bold;
  display: block;
  margin-bottom: 4px;
}

.tool-result pre {
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  font-size: 12px;
  background: rgba(0, 0, 0, 0.05);
  padding: 6px;
  border-radius: 4px;
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
