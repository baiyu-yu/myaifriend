import Store from 'electron-store'
import fs from 'fs'
import path from 'path'
import { Conversation, ConversationSummary } from '../common/types'

type ConversationStoreShape = {
  conversations: Conversation[]
}

export class ConversationManager {
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
    this.store = new Store<ConversationStoreShape>({
      name: 'aibot-conversations',
      ...fallbackOptions,
      defaults: {
        conversations: [],
      },
    })
  }

  list(): ConversationSummary[] {
    const items = this.getAll()
    return items
      .map((item) => ({
        id: item.id,
        title: item.title,
        characterId: item.characterId,
        updatedAt: item.updatedAt,
        messageCount: item.messages.length,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): Conversation | null {
    return this.getAll().find((item) => item.id === id) ?? null
  }

  create(conversation: Conversation): Conversation {
    const all = this.getAll()
    all.unshift(conversation)
    this.saveAll(all)
    return conversation
  }

  save(conversation: Conversation): void {
    const all = this.getAll()
    const index = all.findIndex((item) => item.id === conversation.id)
    if (index >= 0) {
      all[index] = conversation
    } else {
      all.unshift(conversation)
    }
    this.saveAll(all)
  }

  delete(id: string): void {
    const all = this.getAll().filter((item) => item.id !== id)
    this.saveAll(all)
  }

  all(): Conversation[] {
    return this.getAll()
  }

  private getAll(): Conversation[] {
    const value = this.store.get('conversations')
    return Array.isArray(value) ? value : []
  }

  private saveAll(conversations: Conversation[]): void {
    this.store.set('conversations', conversations)
  }
}
