import { shell } from 'electron'
import path from 'path'
import { ITool } from '../tool-manager'
import { ToolDefinition, ToolResult } from '../../../common/types'

export class OpenBrowserTool implements ITool {
  definition: ToolDefinition = {
    name: 'open_in_browser',
    description: '使用系统默认浏览器打开 HTML 文件或 URL。',
    parameters: {
      path: {
        type: 'string',
        description: '目标 HTML 文件路径或 URL',
      },
    },
    required: ['path'],
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const targetPath = args.path as string

    try {
      if (targetPath.startsWith('http://') || targetPath.startsWith('https://')) {
        await shell.openExternal(targetPath)
      } else {
        const absPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(targetPath)
        await shell.openPath(absPath)
      }

      return { toolCallId: '', content: `已打开: ${targetPath}` }
    } catch (error) {
      return {
        toolCallId: '',
        content: `打开失败: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }
}
