import { shell } from 'electron'
import fs from 'fs/promises'
import { ITool } from '../tool-manager'
import { AppConfig, ToolDefinition, ToolResult } from '../../../common/types'
import { resolvePathInWatchFolders } from '../watch-folder-guard'

export class OpenBrowserTool implements ITool {
  private getConfig?: () => AppConfig

  constructor(getConfig?: () => AppConfig) {
    this.getConfig = getConfig
  }

  definition: ToolDefinition = {
    name: 'open_in_browser',
    description: 'Open an HTML file (inside watch folders) or URL in system default browser.',
    parameters: {
      path: {
        type: 'string',
        description: 'Target HTML file path or URL',
      },
      watch_folder: {
        type: 'string',
        description: 'Watch folder path when multiple watch folders are configured',
      },
    },
    required: ['path'],
  }

  private resolvePath(args: Record<string, unknown>): { ok: true; path: string } | { ok: false; reason: string } {
    const rawPath = String(args.path || '').trim()
    if (!rawPath) {
      return { ok: false, reason: 'path is required' }
    }

    if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
      return { ok: true, path: rawPath }
    }

    const resolved = resolvePathInWatchFolders({
      rawPath,
      selectedWatchFolder: String(args.watch_folder || ''),
      watchFolders: this.getConfig?.().watchFolders || [],
      operationName: 'open_in_browser',
    })
    if (!resolved.ok) {
      return { ok: false, reason: resolved.reason }
    }

    return { ok: true, path: resolved.path }
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const resolved = this.resolvePath(args)
    if (!resolved.ok) {
      return {
        toolCallId: '',
        content: resolved.reason,
        isError: true,
      }
    }
    const targetPath = resolved.path

    try {
      if (targetPath.startsWith('http://') || targetPath.startsWith('https://')) {
        await shell.openExternal(targetPath)
      } else {
        const stat = await fs.stat(targetPath).catch(() => null)
        if (!stat || !stat.isFile()) {
          return {
            toolCallId: '',
            content: `Open failed: file does not exist or is not a file: ${targetPath}`,
            isError: true,
          }
        }
        const openError = await shell.openPath(targetPath)
        if (openError) {
          return {
            toolCallId: '',
            content: `Open failed: ${openError}`,
            isError: true,
          }
        }
      }

      return { toolCallId: '', content: `Opened: ${targetPath}` }
    } catch (error) {
      return {
        toolCallId: '',
        content: `Open failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }
}
