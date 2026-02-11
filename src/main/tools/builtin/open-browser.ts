import { shell } from 'electron'
import path from 'path'
import { ITool } from '../tool-manager'
import { ToolDefinition, ToolResult } from '../../../common/types'

export class OpenBrowserTool implements ITool {
  definition: ToolDefinition = {
    name: 'open_in_browser',
    description: '使用系统默认浏览器打开指定的 HTML 文件或 URL。',
    parameters: {
      path: {
        type: 'string',
        description: '要打开的 HTML 文件路径或 URL'
      }
    },
    required: ['path']
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const targetPath = args.path as string

    try {
      // 判断是 URL 还是文件路径
      if (targetPath.startsWith('http://') || targetPath.startsWith('https://')) {
        await shell.openExternal(targetPath)
      } else {
        // 确保路径是绝对路径
        const absPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(targetPath)
        await shell.openPath(absPath)
      }

      return { toolCallId: '', content: `已打开: ${targetPath}` }
    } catch (error) {
      return {
        toolCallId: '',
        content: `打开失败: ${error instanceof Error ? error.message : String(error)}`,
        isError: true
      }
    }
  }
}
