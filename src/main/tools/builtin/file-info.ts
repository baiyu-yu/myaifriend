import fs from 'fs/promises'
import path from 'path'
import { ITool } from '../tool-manager'
import { ToolDefinition, ToolResult } from '../../../common/types'

export class FileInfoTool implements ITool {
  definition: ToolDefinition = {
    name: 'file_info',
    description: '读取文件或目录的基础信息（类型、大小、时间、扩展名）。',
    parameters: {
      path: {
        type: 'string',
        description: '目标文件或目录完整路径',
      },
    },
    required: ['path'],
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const targetPath = String(args.path || '').trim()
    if (!targetPath) {
      return { toolCallId: '', content: '参数 path 不能为空', isError: true }
    }

    try {
      const stat = await fs.stat(targetPath)
      const result = {
        path: targetPath,
        name: path.basename(targetPath),
        ext: path.extname(targetPath).toLowerCase(),
        type: stat.isDirectory() ? 'directory' : 'file',
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
      }
      return { toolCallId: '', content: JSON.stringify(result, null, 2) }
    } catch (error) {
      return {
        toolCallId: '',
        content: `读取文件信息失败: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }
}

