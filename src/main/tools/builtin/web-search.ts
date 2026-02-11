import { ITool } from '../tool-manager'
import { AppConfig, ToolDefinition, ToolResult } from '../../../common/types'

type SearchProvider = 'auto' | 'duckduckgo' | 'searxng' | 'wikipedia'

interface DuckDuckGoResponse {
  AbstractText?: string
  AbstractURL?: string
  RelatedTopics?: Array<
    | {
        Text?: string
        FirstURL?: string
      }
    | {
        Name?: string
        Topics?: Array<{ Text?: string; FirstURL?: string }>
      }
  >
}

interface SearxngResponse {
  results?: Array<{ title?: string; url?: string; content?: string }>
}

type FlatTopic = { Text?: string; FirstURL?: string }
type GroupTopic = { Name?: string; Topics?: FlatTopic[] }

function isGroupTopic(topic: FlatTopic | GroupTopic): topic is GroupTopic {
  return typeof (topic as GroupTopic).Topics !== 'undefined'
}

function collectTopics(payload: DuckDuckGoResponse): Array<{ title: string; url: string }> {
  const items: Array<{ title: string; url: string }> = []
  const pushItem = (text?: string, url?: string) => {
    if (!text || !url) return
    items.push({ title: text, url })
  }

  pushItem(payload.AbstractText, payload.AbstractURL)
  for (const topic of payload.RelatedTopics || []) {
    if (isGroupTopic(topic) && Array.isArray(topic.Topics)) {
      for (const sub of topic.Topics) {
        pushItem(sub.Text, sub.FirstURL)
      }
      continue
    }
    pushItem((topic as FlatTopic).Text, (topic as FlatTopic).FirstURL)
  }
  return items
}

async function fetchJsonWithRetry<T>(url: string, timeoutMs: number, retries: number): Promise<T> {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'aibot-web-search/1.1' },
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      return (await response.json()) as T
    } catch (error) {
      lastError = error
      if (attempt === retries) break
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'unknown error'))
}

function normalizeResult(items: Array<{ title?: string; url?: string; snippet?: string }>) {
  const dedup = new Map<string, { title: string; url: string; snippet: string }>()
  for (const item of items) {
    const title = String(item.title || '').trim()
    const url = String(item.url || '').trim()
    const snippet = String(item.snippet || '').trim()
    if (!title || !url) continue
    if (!dedup.has(url)) dedup.set(url, { title, url, snippet })
  }
  return Array.from(dedup.values())
}

function normalizeDomainList(domains: string[]): string[] {
  return domains
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => item.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
}

function domainAllowed(urlValue: string, allowDomains: string[], blockDomains: string[]): boolean {
  try {
    const host = new URL(urlValue).hostname.toLowerCase()
    const matches = (domain: string) => host === domain || host.endsWith(`.${domain}`)
    const inBlockList = blockDomains.some(matches)
    if (inBlockList) return false
    if (allowDomains.length === 0) return true
    return allowDomains.some(matches)
  } catch {
    return false
  }
}

export class WebSearchTool implements ITool {
  private getConfig?: () => AppConfig

  constructor(getConfig?: () => AppConfig) {
    this.getConfig = getConfig
  }

  definition: ToolDefinition = {
    name: 'web_search',
    description: '联网搜索公开网页信息，支持多源检索和失败重试，返回相关标题和链接。',
    parameters: {
      query: {
        type: 'string',
        description: '搜索关键词',
      },
      provider: {
        type: 'string',
        description: '搜索源：auto/duckduckgo/searxng/wikipedia，默认 auto',
        enum: ['auto', 'duckduckgo', 'searxng', 'wikipedia'],
      },
      searxngBaseUrl: {
        type: 'string',
        description: '当 provider=searxng 时使用，例如 https://searx.example.com',
      },
      maxResults: {
        type: 'number',
        description: '返回结果数量，默认 5，最大 10',
      },
      timeoutMs: {
        type: 'number',
        description: '单次请求超时时间，默认 8000ms',
      },
      retries: {
        type: 'number',
        description: '失败重试次数，默认 1',
      },
    },
    required: ['query'],
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.query || '').trim()
    if (!query) {
      return { toolCallId: '', content: '缺少 query 参数', isError: true }
    }

    const provider = (String(args.provider || 'auto').toLowerCase() as SearchProvider) || 'auto'
    const searxngBaseUrl = String(args.searxngBaseUrl || '').trim().replace(/\/+$/, '')
    const maxResults = Math.min(10, Math.max(1, Number(args.maxResults || 5)))
    const timeoutMs = Math.min(20000, Math.max(1000, Number(args.timeoutMs || 8000)))
    const retries = Math.min(3, Math.max(0, Number(args.retries || 1)))

    const providers: SearchProvider[] =
      provider === 'auto'
        ? [searxngBaseUrl ? 'searxng' : 'duckduckgo', 'wikipedia']
        : [provider]

    try {
      let finalItems: Array<{ title: string; url: string; snippet: string }> = []
      let usedProvider: SearchProvider | '' = ''
      let lastError: string | null = null

      for (const p of providers) {
        try {
          if (p === 'duckduckgo') {
            const endpoint = `https://api.duckduckgo.com/?q=${encodeURIComponent(
              query
            )}&format=json&no_html=1&no_redirect=1&kl=us-en`
            const payload = await fetchJsonWithRetry<DuckDuckGoResponse>(endpoint, timeoutMs, retries)
            const items = normalizeResult(
              collectTopics(payload).map((item) => ({ title: item.title, url: item.url, snippet: '' }))
            )
            if (items.length > 0) {
              finalItems = items
              usedProvider = p
              break
            }
          } else if (p === 'wikipedia') {
            const endpoint = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(
              query
            )}&limit=${maxResults}&namespace=0&format=json`
            const payload = await fetchJsonWithRetry<[string, string[], string[], string[]]>(endpoint, timeoutMs, retries)
            const titles = Array.isArray(payload[1]) ? payload[1] : []
            const snippets = Array.isArray(payload[2]) ? payload[2] : []
            const urls = Array.isArray(payload[3]) ? payload[3] : []
            const items = normalizeResult(
              titles.map((title, index) => ({
                title,
                url: urls[index],
                snippet: snippets[index] || '',
              }))
            )
            if (items.length > 0) {
              finalItems = items
              usedProvider = p
              break
            }
          } else if (p === 'searxng') {
            if (!searxngBaseUrl) {
              throw new Error('provider=searxng 需要 searxngBaseUrl')
            }
            const endpoint = `${searxngBaseUrl}/search?q=${encodeURIComponent(query)}&format=json&language=zh-CN`
            const payload = await fetchJsonWithRetry<SearxngResponse>(endpoint, timeoutMs, retries)
            const items = normalizeResult(
              (payload.results || []).map((item) => ({
                title: item.title || '',
                url: item.url || '',
                snippet: item.content || '',
              }))
            )
            if (items.length > 0) {
              finalItems = items
              usedProvider = p
              break
            }
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error)
        }
      }

      if (!finalItems.length) {
        if (lastError) {
          return { toolCallId: '', content: `网络搜索失败: ${lastError}`, isError: true }
        }
        return { toolCallId: '', content: `未找到与“${query}”相关的公开结果。` }
      }

      const config = this.getConfig?.()
      const allowDomains = normalizeDomainList(config?.webSearch?.allowDomains || [])
      const blockDomains = normalizeDomainList(config?.webSearch?.blockDomains || [])
      const filteredItems = finalItems.filter((item) => domainAllowed(item.url, allowDomains, blockDomains))
      if (!filteredItems.length) {
        return { toolCallId: '', content: '搜索结果已被域名过滤规则全部拦截。', isError: true }
      }

      const content = filteredItems
        .slice(0, maxResults)
        .map(
          (item, index) =>
            `${index + 1}. ${item.title}\n${item.url}${item.snippet ? `\n摘要: ${item.snippet}` : ''}`
        )
        .join('\n\n')
      return { toolCallId: '', content: `[来源: ${usedProvider || provider}] ${content}` }
    } catch (error) {
      return {
        toolCallId: '',
        content: `网络搜索失败: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }
}
