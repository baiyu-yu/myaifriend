import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import type { ChatMessage, Conversation, ConversationSummary, InvokeContext } from '../../../common/types'
import { useConfigStore } from './config'

function formatNowForTitle(): string {
  const now = new Date()
  const yy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  return `${yy}-${mm}-${dd} ${hh}:${mi}`
}

function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([])
  const isLoading = ref(false)
  const currentInput = ref('')
  const conversations = ref<ConversationSummary[]>([])
  const activeConversationId = ref('')

  const configStore = useConfigStore()

  const activeConversation = computed(
    () => conversations.value.find((item) => item.id === activeConversationId.value) || null
  )

  async function getElectronAPI(timeoutMs = 3000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const api = window.electronAPI
      if (api?.chat) return api
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('Electron API 未就绪，请确认通过桌面应用启动。')
  }

  function buildGreetingMessages(): ChatMessage[] {
    const char = configStore.activeCharacter
    if (!char?.greeting) return []
    return [
      {
        id: uuidv4(),
        role: 'assistant',
        content: char.greeting,
        timestamp: Date.now(),
      },
    ]
  }

  async function refreshConversationList() {
    conversations.value = await (await getElectronAPI()).chat.historyList()
  }

  async function addChatLog(level: 'info' | 'warn' | 'error', message: string) {
    const api = window.electronAPI
    if (!api?.app?.log?.add) return
    try {
      await api.app.log.add(level, message, 'chat')
    } catch {
      // ignore log failure
    }
  }

  async function initConversation() {
    await refreshConversationList()
    if (conversations.value.length > 0) {
      await loadConversation(conversations.value[0].id)
      return
    }
    await createConversation()
  }

  async function createConversation() {
    const now = Date.now()
    const conversation: Conversation = {
      id: uuidv4(),
      characterId: configStore.config.activeCharacterId,
      title: `新会话 ${formatNowForTitle()}`,
      messages: buildGreetingMessages(),
      createdAt: now,
      updatedAt: now,
    }
    await (await getElectronAPI()).chat.historyCreate(conversation)
    activeConversationId.value = conversation.id
    messages.value = [...conversation.messages]
    await refreshConversationList()
  }

  async function loadConversation(id: string) {
    const conversation = await (await getElectronAPI()).chat.historyGet(id)
    if (!conversation) return
    activeConversationId.value = conversation.id
    messages.value = Array.isArray(conversation.messages) ? conversation.messages : []
  }

  async function saveCurrentConversation(titleOverride?: string) {
    if (!activeConversationId.value) return
    const current = await (await getElectronAPI()).chat.historyGet(activeConversationId.value)
    if (!current) return
    const updated: Conversation = {
      ...current,
      title: titleOverride || current.title,
      characterId: configStore.config.activeCharacterId,
      messages: toPlain(messages.value),
      updatedAt: Date.now(),
    }
    await (await getElectronAPI()).chat.historySave(updated)
    await refreshConversationList()
  }

  async function renameConversation(title: string) {
    const normalized = title.trim()
    if (!normalized || !activeConversationId.value) return
    await saveCurrentConversation(normalized)
  }

  async function deleteConversation(id: string) {
    await (await getElectronAPI()).chat.historyDelete(id)
    if (activeConversationId.value === id) {
      activeConversationId.value = ''
      messages.value = []
    }
    await refreshConversationList()
    if (!activeConversationId.value) {
      if (conversations.value.length > 0) {
        await loadConversation(conversations.value[0].id)
      } else {
        await createConversation()
      }
    }
  }

  async function sendMessage(content: string, invokeContext: InvokeContext = { trigger: 'text_input' }) {
    if (!content.trim() || isLoading.value) return

    const trimmed = content.trim()
    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    }
    messages.value.push(userMsg)
    currentInput.value = ''
    isLoading.value = true

    const firstUserMsg = messages.value.find((item) => item.role === 'user')
    const titleCandidate = firstUserMsg ? firstUserMsg.content.slice(0, 20) : undefined

    try {
      const char = configStore.activeCharacter
      const apiMessages: ChatMessage[] = []

      if (char?.systemPrompt) {
        apiMessages.push({
          id: 'system',
          role: 'system',
          content: char.systemPrompt,
          timestamp: 0,
        })
      }

      apiMessages.push(...messages.value)

      const api = await getElectronAPI()
      const response = await api.chat.send(toPlain(apiMessages), undefined, undefined, invokeContext)
      const choice = response.choices?.[0]
      const inference = response.meta

      if (choice?.message) {
        const assistantMsg: ChatMessage = {
          id: uuidv4(),
          role: 'assistant',
          content: choice.message.content || '',
          timestamp: Date.now(),
          ...(inference ? { inference } : {}),
        }

        if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
          assistantMsg.toolCalls = choice.message.tool_calls.map((tc: any) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          }))
          messages.value.push(assistantMsg)

          const toolCalls = assistantMsg.toolCalls || []
          for (const toolCall of toolCalls) {
            const safeArgs = toPlain(toolCall.arguments || {})
            const result = await api.tools.execute(toolCall.name, safeArgs)
            messages.value.push({
              id: uuidv4(),
              role: 'tool',
              content: result.content,
              timestamp: Date.now(),
              toolCallId: toolCall.id,
            })
          }

          const followUpMessages = [
            ...(char?.systemPrompt
              ? [{ id: 'system', role: 'system' as const, content: char.systemPrompt, timestamp: 0 }]
              : []),
            ...messages.value,
          ]
          const followUp = await api.chat.send(toPlain(followUpMessages), undefined, undefined, invokeContext)
          const followUpChoice = followUp.choices?.[0]
          if (followUpChoice?.message?.content) {
            messages.value.push({
              id: uuidv4(),
              role: 'assistant',
              content: followUpChoice.message.content,
              timestamp: Date.now(),
              ...(followUp.meta ? { inference: followUp.meta } : {}),
            })
          }
        } else {
          messages.value.push(assistantMsg)
        }
      }
    } catch (error) {
      await addChatLog('error', `发送或触发失败: ${error instanceof Error ? error.message : String(error)}`)
      messages.value.push({
        id: uuidv4(),
        role: 'assistant',
        content: `发生错误: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      })
    } finally {
      isLoading.value = false
      await saveCurrentConversation(titleCandidate)
    }
  }

  async function handleTrigger(context: InvokeContext) {
    const config = configStore.config
    let prompt = config.triggerPrompts[context.trigger] || ''
    await addChatLog('info', `触发对话: ${context.trigger}`)

    if (context.fileChangeInfo) {
      prompt = prompt.replace(
        '{{fileChangeInfo}}',
        `文件 "${context.fileChangeInfo.filePath}" 发生 "${context.fileChangeInfo.type}" 变动`
      )
    }

    if (prompt) {
      await sendMessage(prompt, context)
      // If triggered by non-dialog means and Live2D has a model, show reply below avatar
      if (context.trigger !== 'text_input' && config.live2dModelPath) {
        const lastAssistant = [...messages.value].reverse().find((m) => m.role === 'assistant')
        if (lastAssistant?.content) {
          ;(await getElectronAPI()).live2d.showReply(lastAssistant.content)
        }
      }
    }
  }

  async function clearMessages() {
    messages.value = buildGreetingMessages()
    await saveCurrentConversation()
  }

  return {
    messages,
    isLoading,
    currentInput,
    conversations,
    activeConversationId,
    activeConversation,
    initConversation,
    createConversation,
    loadConversation,
    renameConversation,
    deleteConversation,
    sendMessage,
    handleTrigger,
    clearMessages,
  }
})
