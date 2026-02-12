import Store from 'electron-store'
import fs from 'fs'
import path from 'path'

export interface MemoryItem {
  id: string
  sourceId: string
  text: string
  embedding: number[]
  createdAt: number
  updatedAt: number
  hits: number
}

type MemoryStoreShape = {
  memories: MemoryItem[]
}

function tokenize(text: string): string[] {
  const lowered = text.toLowerCase()
  const words = lowered.match(/[a-z0-9\u4e00-\u9fa5]+/g) || []
  return words.filter((w) => w.length >= 2)
}

function lexicalOverlapScore(query: string, target: string): number {
  const q = new Set(tokenize(query))
  const t = new Set(tokenize(target))
  if (q.size === 0 || t.size === 0) return 0
  let hits = 0
  for (const item of q) {
    if (t.has(item)) hits += 1
  }
  return hits / Math.sqrt(q.size * t.size)
}

function textDedupeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .slice(0, 120)
}

function splitToFragments(text: string, maxLen = 120): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const sentences = trimmed
    .split(/[\n。！？!?；;]+/)
    .map((item) => item.trim())
    .filter(Boolean)

  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (!current) {
      current = sentence
      continue
    }
    if (`${current} ${sentence}`.length <= maxLen) {
      current = `${current} ${sentence}`
    } else {
      chunks.push(current)
      current = sentence
    }
  }
  if (current) chunks.push(current)

  if (chunks.length === 0 && trimmed) return [trimmed.slice(0, maxLen)]
  return chunks
}

const EMBEDDING_DIM = 256

function toEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIM).fill(0)
  const tokens = tokenize(text)
  if (!tokens.length) return vector

  for (const token of tokens) {
    let hash = 2166136261
    for (let i = 0; i < token.length; i += 1) {
      hash ^= token.charCodeAt(i)
      hash = (hash * 16777619) >>> 0
    }
    const idx = hash % EMBEDDING_DIM
    vector[idx] += 1
  }

  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0))
  if (norm > 0) {
    for (let i = 0; i < vector.length; i += 1) {
      vector[i] /= norm
    }
  }
  return vector
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
  }
  return dot
}

export class MemoryManager {
  private store: any

  constructor() {
    const testCwd = path.join(process.cwd(), '.aibot-test-store', String(process.pid))
    if (!process.versions.electron) {
      fs.mkdirSync(testCwd, { recursive: true })
    }
    const fallbackOptions =
      process.versions.electron
        ? {}
        : {
            cwd: testCwd,
            projectVersion: '0.0.0',
          }
    this.store = new Store<MemoryStoreShape>({
      name: 'aibot-memory',
      ...fallbackOptions,
      defaults: {
        memories: [],
      },
    })
  }

  retrieve(query: string, topK: number, minScore = 0.22, deduplicate = true): MemoryItem[] {
    const now = Date.now()
    const all = this.getAll()
    const queryEmbedding = toEmbedding(query)
    const ranked = all
      .map((item) => {
        const vectorSimilarity = cosineSimilarity(queryEmbedding, item.embedding)
        const lexicalSimilarity = lexicalOverlapScore(query, item.text)
        const recencyBoost = Math.max(0, 1 - (now - item.updatedAt) / (1000 * 60 * 60 * 24 * 30))
        const hitBoost = Math.min(0.15, item.hits * 0.01)
        const score = vectorSimilarity * 0.65 + lexicalSimilarity * 0.2 + recencyBoost * 0.1 + hitBoost * 0.05
        return { item, score }
      })
      .filter((entry) => entry.score >= minScore)
      .sort((a, b) => b.score - a.score)

    const selected: MemoryItem[] = []
    const seenSourceId = new Set<string>()
    const seenTextKey = new Set<string>()
    for (const entry of ranked) {
      if (selected.length >= Math.max(0, topK)) break
      if (deduplicate) {
        if (seenSourceId.has(entry.item.sourceId)) continue
        const key = textDedupeKey(entry.item.text)
        if (seenTextKey.has(key)) continue
        seenSourceId.add(entry.item.sourceId)
        seenTextKey.add(key)
      }
      selected.push(entry.item)
    }

    if (selected.length > 0) {
      const idSet = new Set(selected.map((item) => item.id))
      const updated = all.map((item) => {
        if (!idSet.has(item.id)) return item
        return { ...item, hits: item.hits + 1, updatedAt: now }
      })
      this.saveAll(updated)
    }

    return selected
  }

  remember(text: string, maxItems: number): void {
    const fragments = splitToFragments(text)
    if (!fragments.length) return
    const all = this.getAll()
    const now = Date.now()
    const sourceId = `${now}-${Math.random().toString(16).slice(2)}`

    for (const fragment of fragments) {
      const normalized = fragment.trim()
      if (!normalized) continue

      const existingIndex = all.findIndex((item) => item.text === normalized)
      if (existingIndex >= 0) {
        all[existingIndex] = {
          ...all[existingIndex],
          updatedAt: now,
          embedding: all[existingIndex].embedding?.length ? all[existingIndex].embedding : toEmbedding(normalized),
        }
        continue
      }

      all.unshift({
        id: `${now}-${Math.random().toString(16).slice(2)}`,
        sourceId,
        text: normalized,
        embedding: toEmbedding(normalized),
        createdAt: now,
        updatedAt: now,
        hits: 0,
      })
    }

    if (all.length > maxItems) {
      all.length = maxItems
    }
    this.saveAll(all)
  }

  list(): MemoryItem[] {
    return this.getAll().sort((a, b) => b.updatedAt - a.updatedAt)
  }

  delete(id: string): void {
    const next = this.getAll().filter((item) => item.id !== id)
    this.saveAll(next)
  }

  clear(): void {
    this.saveAll([])
  }

  merge(ids: string[], maxItems = 500): MemoryItem | null {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)))
    if (uniqueIds.length < 2) return null

    const all = this.getAll()
    const selected = all.filter((item) => uniqueIds.includes(item.id))
    if (selected.length < 2) return null

    const mergedText = selected
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join('。')
      .replace(/。+/g, '。')
      .slice(0, 1200)
      .trim()

    if (!mergedText) return null

    const remaining = all.filter((item) => !uniqueIds.includes(item.id))
    this.saveAll(remaining)
    this.remember(mergedText, maxItems)
    return this.list()[0] || null
  }

  private getAll(): MemoryItem[] {
    const value = this.store.get('memories')
    if (!Array.isArray(value)) return []
    return value
      .filter((item): item is Partial<MemoryItem> => typeof item === 'object' && item !== null)
      .map((item) => {
        const text = String(item.text || '').trim()
        return {
          id: String(item.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
          sourceId: String(item.sourceId || item.id || 'legacy'),
          text,
          embedding:
            Array.isArray(item.embedding) && item.embedding.length === EMBEDDING_DIM
              ? item.embedding.map((v) => Number(v) || 0)
              : toEmbedding(text),
          createdAt: Number(item.createdAt || Date.now()),
          updatedAt: Number(item.updatedAt || Date.now()),
          hits: Number(item.hits || 0),
        }
      })
      .filter((item) => item.text.length > 0)
  }

  private saveAll(memories: MemoryItem[]): void {
    this.store.set('memories', memories)
  }
}
