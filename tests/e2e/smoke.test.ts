import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useConfigStore } from '../../src/renderer/src/stores/config'
import { useChatStore } from '../../src/renderer/src/stores/chat'
import { DEFAULT_CONFIG } from '../../src/common/defaults'
import type { Conversation } from '../../src/common/types'

test('minimum e2e smoke: startup, send, save config, exit', async () => {
  setActivePinia(createPinia())

  let didCloseWindow = false
  let memoryConversations: Conversation[] = []

  ;(globalThis as any).window = {
    electronAPI: {
      config: {
        getAll: async () => structuredClone(DEFAULT_CONFIG),
        get: async () => null,
        set: async () => undefined,
      },
      chat: {
        send: async () => ({
          choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
          meta: { model: 'smoke-model', taskType: 'chat' },
        }),
        historyList: async () =>
          memoryConversations
            .map((c) => ({
              id: c.id,
              title: c.title,
              characterId: c.characterId,
              updatedAt: c.updatedAt,
              messageCount: c.messages.length,
            }))
            .sort((a, b) => b.updatedAt - a.updatedAt),
        historyGet: async (id: string) => memoryConversations.find((c) => c.id === id) || null,
        historyCreate: async (conversation: Conversation) => {
          memoryConversations = [conversation, ...memoryConversations]
        },
        historySave: async (conversation: Conversation) => {
          const idx = memoryConversations.findIndex((c) => c.id === conversation.id)
          if (idx >= 0) memoryConversations[idx] = conversation
          else memoryConversations = [conversation, ...memoryConversations]
        },
        historyDelete: async (id: string) => {
          memoryConversations = memoryConversations.filter((c) => c.id !== id)
        },
        onStream: () => () => undefined,
        abort: async () => undefined,
      },
      tools: { execute: async () => ({ content: 'ok' }), list: async () => [] },
      file: {
        read: async () => '',
        write: async () => '',
        list: async () => [],
        openInBrowser: async () => '',
      },
      live2d: {
        action: async () => undefined,
        loadModel: async () => undefined,
        onAction: () => () => undefined,
        onLoadModel: () => () => undefined,
      },
      window: {
        toggleChat: async () => undefined,
        toggleLive2D: async () => undefined,
        minimize: async () => undefined,
        close: async () => {
          didCloseWindow = true
        },
      },
      on: {
        fileWatchEvent: () => () => undefined,
        triggerInvoke: () => () => undefined,
      },
      trigger: { invoke: async () => undefined },
      dialog: {
        selectFolder: async () => null,
        selectFile: async () => null,
      },
      memory: {
        list: async () => [],
        delete: async () => undefined,
        clear: async () => undefined,
        merge: async () => undefined,
      },
    },
  }

  const configStore = useConfigStore()
  await configStore.loadConfig()

  const chatStore = useChatStore()
  await chatStore.initConversation()
  assert.ok(chatStore.activeConversationId)

  await chatStore.sendMessage('hello')
  const assistantMessages = chatStore.messages.filter((m) => m.role === 'assistant')
  assert.ok(assistantMessages.length >= 1)
  assert.equal(assistantMessages[assistantMessages.length - 1]?.inference?.model, 'smoke-model')

  await configStore.setConfig('hotkeys', {
    toggleChat: 'Alt+Space',
    toggleLive2D: 'Alt+Shift+L',
    toggleLive2DControls: 'Alt+Shift+H',
  })
  assert.equal(configStore.config.hotkeys.toggleLive2D, 'Alt+Shift+L')

  await (globalThis as any).window.electronAPI.window.close()
  assert.equal(didCloseWindow, true)
})
