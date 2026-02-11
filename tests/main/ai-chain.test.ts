import test from 'node:test'
import assert from 'node:assert/strict'
import { injectMemorySystemPrompt, shouldCompressContext } from '../../src/main/ai/ai-engine'
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

test('ai engine uses premier model for dispatch', async () => {
  const config = buildConfig({
    apiConfigs: [{ id: 'api-1', name: 'local', baseUrl: 'http://fake', apiKey: 'k', defaultModel: 'gpt-a', availableModels: [] }],
    modelAssignments: {
      ...DEFAULT_CONFIG.modelAssignments,
      premier: { apiConfigId: 'api-1', model: 'gpt-premier' },
    },
    agentChain: {
      ...DEFAULT_CONFIG.agentChain,
      enableMemory: false,
      enableContextCompression: false,
    },
  })

  const { AIEngine } = await import('../../src/main/ai/ai-engine')
  const engine = new AIEngine({ getAll: () => config } as any)
  const originalFetch = globalThis.fetch

  let fetchCount = 0
  globalThis.fetch = (async () => {
    fetchCount++
    if (fetchCount === 1) {
      // Premier dispatch call
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: '{"chain":[{"taskType":"premier","instruction":""}]}' }, finish_reason: 'stop' }],
        }),
      }
    }
    // Actual response
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }),
    }
  }) as any

  try {
    const result = await engine.chat([{ id: 'u1', role: 'user', content: '你好', timestamp: Date.now() }])
    assert.equal(result.meta?.model, 'gpt-premier')
    assert.equal(result.meta?.taskType, 'premier')
  } finally {
    globalThis.fetch = originalFetch
  }
})
