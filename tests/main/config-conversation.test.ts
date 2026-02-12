import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ConfigManager } from '../../src/main/config-manager'
import { ConversationManager } from '../../src/main/conversation-manager'
import { IPC_CHANNELS, type Conversation } from '../../src/common/types'

function resetTestStore() {
  fs.rmSync(path.join(process.cwd(), '.aibot-test-store'), { recursive: true, force: true })
}

test('config manager persists and loads agent chain settings', () => {
  resetTestStore()
  const manager = new ConfigManager()
  const original = manager.getAll()
  assert.ok(original.agentChain.enableContextCompression !== undefined)

  manager.set('agentChain', {
    ...original.agentChain,
    enableMemory: false,
  })

  const reloaded = new ConfigManager().getAll()
  assert.equal(reloaded.agentChain.enableMemory, false)
})

test('config manager keeps dynamic record keys for live2d/tool toggles', () => {
  resetTestStore()
  const manager = new ConfigManager()
  const modelKey = 'D:\\demo\\model\\hero.model3.json'
  manager.set('live2dActionMap', {
    expression: {
      happy: 'exp_happy',
    },
    motion: {
      wave: 'motion_wave',
    },
  })
  manager.set('live2dModelActionMaps', {
    [modelKey]: {
      expression: {
        smile: 'smile',
      },
      motion: {
        Idle: 'Idle',
      },
    },
  })
  manager.set('toolToggles', {
    web_search: false,
  })

  const reloaded = new ConfigManager().getAll()
  assert.equal(reloaded.live2dActionMap.expression.happy, 'exp_happy')
  assert.equal(reloaded.live2dActionMap.motion.wave, 'motion_wave')
  assert.equal(reloaded.live2dModelActionMaps[modelKey]?.expression?.smile, 'smile')
  assert.equal(reloaded.live2dModelActionMaps[modelKey]?.motion?.Idle, 'Idle')
  assert.equal(reloaded.toolToggles.web_search, false)
})

test('ipc channels contain core chat/config/memory routes', () => {
  assert.equal(IPC_CHANNELS.CONFIG_GET_ALL, 'config:getAll')
  assert.equal(IPC_CHANNELS.CHAT_SEND, 'chat:send')
  assert.equal(IPC_CHANNELS.CHAT_HISTORY_SAVE, 'chat:history:save')
  assert.equal(IPC_CHANNELS.MEMORY_LIST, 'memory:list')
})

test('conversation manager supports create/list/save/delete', () => {
  resetTestStore()
  const manager = new ConversationManager()
  const now = Date.now()
  const conversation: Conversation = {
    id: 'conv-1',
    characterId: 'default',
    title: '测试会话',
    createdAt: now,
    updatedAt: now,
    messages: [],
  }

  manager.create(conversation)
  assert.equal(manager.list().length, 1)
  assert.equal(manager.get('conv-1')?.title, '测试会话')

  manager.save({
    ...conversation,
    title: '更新后标题',
    updatedAt: now + 1000,
  })
  assert.equal(manager.get('conv-1')?.title, '更新后标题')

  manager.delete('conv-1')
  assert.equal(manager.list().length, 0)
})
