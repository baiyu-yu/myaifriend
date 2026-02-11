import test from 'node:test'
import assert from 'node:assert/strict'
import { AIEngine, inferTaskTypeByRules, injectMemorySystemPrompt, shouldCompressContext } from '../../src/main/ai/ai-engine'
import type { AppConfig, ChatMessage } from '../../src/common/types'
import { DEFAULT_CONFIG } from '../../src/common/defaults'

function buildConfig(partial?: Partial<AppConfig>): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    agentChain: {
      ...DEFAULT_CONFIG.agentChain,
      ...(partial?.agentChain || {}),
    },
  }
}

test('task routing prefers custom classifier rules', () => {
  const task = inferTaskTypeByRules('请翻译这段内容', [
    { id: 'r1', name: 'translate', pattern: '翻译', taskType: 'translation', enabled: true, priority: 1 },
  ])
  assert.equal(task, 'translation')
})

test('compression trigger works by token threshold', () => {
  const messages: ChatMessage[] = [
    { id: '1', role: 'user', content: 'a'.repeat(800), timestamp: Date.now() },
  ]
  assert.equal(shouldCompressContext(messages, 100), true)
  assert.equal(shouldCompressContext(messages, 1000), false)
})

test('memory injection adds a system message', () => {
  const base: ChatMessage[] = [{ id: '1', role: 'user', content: '你好', timestamp: Date.now() }]
  const injected = injectMemorySystemPrompt(base, [{ text: '用户喜欢简洁回答' }])
  assert.equal(injected[0].role, 'system')
  assert.match(injected[0].content, /长期记忆/)
  assert.equal(injected.length, 2)
})

test('ai engine returns routed model metadata', async () => {
  const config = buildConfig({
    apiConfigs: [{ id: 'api-1', name: 'local', baseUrl: 'http://fake', apiKey: 'k', defaultModel: 'gpt-a', availableModels: [] }],
    modelRoutes: [{ id: 'm1', name: 'translate-route', taskTypes: ['translation'], apiConfigId: 'api-1', model: 'gpt-translate', priority: 1 }],
    agentChain: {
      ...DEFAULT_CONFIG.agentChain,
      enableAutoTaskRouting: true,
      enableMemory: false,
      enableContextCompression: false,
      taskClassifierRules: [{ id: 'r1', name: 'translate', pattern: '翻译', taskType: 'translation', enabled: true, priority: 1 }],
    },
  })

  const engine = new AIEngine({ getAll: () => config } as any)
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    }),
  })) as any

  try {
    const result = await engine.chat([{ id: 'u1', role: 'user', content: '请翻译 hello', timestamp: Date.now() }])
    assert.equal(result.meta?.model, 'gpt-translate')
    assert.equal(result.meta?.taskType, 'translation')
  } finally {
    globalThis.fetch = originalFetch
  }
})
