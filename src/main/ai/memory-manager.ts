import Store from 'electron-store'

export interface MemoryItem {
  id: string
  text: string
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

function scoreByOverlap(query: string, target: string): number {
  const q = new Set(tokenize(query))
  const t = new Set(tokenize(target))
  if (q.size === 0 || t.size === 0) return 0
  let hits = 0
  for (const item of q) {
    if (t.has(item)) hits += 1
  }
  return hits / Math.sqrt(q.size * t.size)
}

export class MemoryManager {
  private store: any

  constructor() {
    this.store = new Store<MemoryStoreShape>({
      name: 'aibot-memory',
      defaults: {
        memories: [],
      },
    })
  }

  retrieve(query: string, topK: number): MemoryItem[] {
    const now = Date.now()
    const all = this.getAll()
    const ranked = all
      .map((item) => {
        const relevance = scoreByOverlap(query, item.text)
        const recencyBoost = Math.max(0, 1 - (now - item.updatedAt) / (1000 * 60 * 60 * 24 * 30))
        const score = relevance * 0.85 + recencyBoost * 0.15
        return { item, score }
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, topK))
      .map((entry) => entry.item)

    if (ranked.length > 0) {
      const idSet = new Set(ranked.map((item) => item.id))
      const updated = all.map((item) => {
        if (!idSet.has(item.id)) return item
        return { ...item, hits: item.hits + 1, updatedAt: now }
      })
      this.saveAll(updated)
    }

    return ranked
  }

  remember(text: string, maxItems: number): void {
    const normalized = text.trim()
    if (!normalized) return

    const all = this.getAll()
    const now = Date.now()
    const existingIndex = all.findIndex((item) => item.text === normalized)
    if (existingIndex >= 0) {
      all[existingIndex] = {
        ...all[existingIndex],
        updatedAt: now,
      }
      this.saveAll(all)
      return
    }

    all.unshift({
      id: `${now}-${Math.random().toString(16).slice(2)}`,
      text: normalized,
      createdAt: now,
      updatedAt: now,
      hits: 0,
    })

    if (all.length > maxItems) {
      all.length = maxItems
    }
    this.saveAll(all)
  }

  private getAll(): MemoryItem[] {
    const value = this.store.get('memories')
    return Array.isArray(value) ? value : []
  }

  private saveAll(memories: MemoryItem[]): void {
    this.store.set('memories', memories)
  }
}
