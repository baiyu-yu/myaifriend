import { ITool } from '../tool-manager'
import { ToolDefinition, ToolResult } from '../../../common/types'
import { ConversationManager } from '../../conversation-manager'

export class ConversationSearchTool implements ITool {
  constructor(private conversationManager: ConversationManager) {}

  definition: ToolDefinition = {
    name: 'conversation_search',
    description: '按关键词检索历史会话内容（主动回忆层）。',
    parameters: {
      query: { type: 'string', description: '检索关键词' },
      limit: { type: 'number', description: '返回条数，默认 10' },
    },
    required: ['query'],
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.query || '').trim()
    if (!query) {
      return { toolCallId: '', content: '参数 query 不能为空', isError: true }
    }
    const limit = Math.max(1, Math.min(30, Number(args.limit || 10)))
    const all = this.conversationManager.all()
    const lowered = query.toLowerCase()

    const matched: string[] = []
    for (const conv of all) {
      for (const msg of conv.messages) {
        if (!msg.content) continue
        if (msg.content.toLowerCase().includes(lowered)) {
          matched.push(`- [${conv.title}] (${msg.role}) ${msg.content.slice(0, 120)}`)
          if (matched.length >= limit) break
        }
      }
      if (matched.length >= limit) break
    }

    return { toolCallId: '', content: matched.join('\n') || '未检索到相关历史会话' }
  }
}

