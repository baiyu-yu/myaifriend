import { ITool } from '../tool-manager'
import { ToolDefinition, ToolResult } from '../../../common/types'
import { MemoryManager } from '../../ai/memory-manager'

export class MemorySearchTool implements ITool {
  constructor(private memoryManager: MemoryManager) {}

  definition: ToolDefinition = {
    name: 'memory_search',
    description: '按关键词检索长期记忆（主动回忆层）。',
    parameters: {
      query: { type: 'string', description: '检索关键词或短句' },
      topK: { type: 'number', description: '返回数量，默认 5' },
    },
    required: ['query'],
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.query || '').trim()
    if (!query) {
      return { toolCallId: '', content: '参数 query 不能为空', isError: true }
    }
    const topK = Math.max(1, Math.min(20, Number(args.topK || 5)))
    const result = this.memoryManager.retrieve(query, topK, 0.05, false)
    const text = result.map((item, idx) => `${idx + 1}. ${item.text}`).join('\n')
    return { toolCallId: '', content: text || '未检索到相关记忆' }
  }
}

