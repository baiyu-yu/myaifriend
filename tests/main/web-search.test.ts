import test from 'node:test'
import assert from 'node:assert/strict'
import { WebSearchTool } from '../../src/main/tools/builtin/web-search'
import { DEFAULT_CONFIG } from '../../src/common/defaults'

test('web_search auto provider falls back to wikipedia', async () => {
  const tool = new WebSearchTool()
  const originalFetch = globalThis.fetch
  let callCount = 0

  globalThis.fetch = (async (url: string) => {
    callCount += 1
    if (url.includes('duckduckgo.com')) {
      return {
        ok: true,
        json: async () => ({ RelatedTopics: [] }),
      } as any
    }
    return {
      ok: true,
      json: async () => ['q', ['TypeScript'], ['language'], ['https://example.com/ts']],
    } as any
  }) as any

  try {
    const result = await tool.execute({ query: 'typescript', provider: 'auto', maxResults: 3 })
    assert.equal(result.isError, undefined)
    assert.match(result.content, /TypeScript/)
    assert.ok(callCount >= 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('web_search searxng validates base url', async () => {
  const tool = new WebSearchTool()
  const result = await tool.execute({ query: 'abc', provider: 'searxng' })
  assert.equal(result.isError, true)
  assert.match(result.content, /searxngBaseUrl/)
})

test('web_search respects allow/block domains', async () => {
  const tool = new WebSearchTool(() => ({
    ...DEFAULT_CONFIG,
    webSearch: {
      allowDomains: ['example.com'],
      blockDomains: ['blocked.example.com'],
    },
  }))
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      RelatedTopics: [
        { Text: 'a', FirstURL: 'https://example.com/a' },
        { Text: 'b', FirstURL: 'https://blocked.example.com/b' },
      ],
    }),
  })) as any

  try {
    const result = await tool.execute({ query: 'abc', provider: 'duckduckgo' })
    assert.equal(result.isError, undefined)
    assert.match(result.content, /example\.com\/a/)
    assert.doesNotMatch(result.content, /blocked\.example\.com/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
