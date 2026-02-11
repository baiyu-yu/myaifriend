import fs from 'fs/promises'
import path from 'path'
import { ITool } from '../tool-manager'
import { ToolDefinition, ToolResult } from '../../../common/types'

export class FileListTool implements ITool {
  definition: ToolDefinition = {
    name: 'file_list',
    description: '列出指定目录中的文件和子目录。',
    parameters: {
      path: {
        type: 'string',
        description: '要列出的目录路径',
      },
      recursive: {
        type: 'boolean',
        description: '是否递归列出子目录内容，默认 false',
      },
    },
    required: ['path'],
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const folderPath = args.path as string
    const recursive = (args.recursive as boolean) || false

    try {
      const items = await this.listDir(folderPath, recursive, 0)
      return { toolCallId: '', content: items.join('\n') }
    } catch (error) {
      return {
        toolCallId: '',
        content: `列出文件失败: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }

  private async listDir(dirPath: string, recursive: boolean, depth: number): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const result: string[] = []
    const indent = '  '.repeat(depth)

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        result.push(`${indent}[DIR] ${entry.name}/`)
        if (recursive && depth < 3) {
          const children = await this.listDir(fullPath, recursive, depth + 1)
          result.push(...children)
        }
      } else {
        const stat = await fs.stat(fullPath)
        const sizeKB = (stat.size / 1024).toFixed(1)
        result.push(`${indent}[FILE] ${entry.name} (${sizeKB} KB)`)
      }
    }

    return result
  }
}
