import fs from 'fs/promises'
import path from 'path'
import { ITool } from '../tool-manager'
import { AppConfig, ToolDefinition, ToolResult } from '../../../common/types'
import { resolvePathInWatchFolders } from '../watch-folder-guard'

export class FileInfoTool implements ITool {
  private getConfig?: () => AppConfig

  constructor(getConfig?: () => AppConfig) {
    this.getConfig = getConfig
  }

  definition: ToolDefinition = {
    name: 'file_info',
    description: 'Read basic metadata for a file or directory.',
    parameters: {
      path: {
        type: 'string',
        description: 'Target file or directory path',
      },
      watch_folder: {
        type: 'string',
        description: 'Watch folder path when multiple watch folders are configured',
      },
    },
    required: ['path'],
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const resolved = resolvePathInWatchFolders({
      rawPath: String(args.path || ''),
      selectedWatchFolder: String(args.watch_folder || ''),
      watchFolders: this.getConfig?.().watchFolders || [],
      operationName: 'file_info',
    })
    if (!resolved.ok) {
      return { toolCallId: '', content: resolved.reason, isError: true }
    }
    const targetPath = resolved.path

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
        content: `Read file info failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }
}
