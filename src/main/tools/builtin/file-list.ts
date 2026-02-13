import fs from 'fs/promises'
import path from 'path'
import { ITool } from '../tool-manager'
import { AppConfig, ToolDefinition, ToolResult } from '../../../common/types'
import { resolvePathInWatchFolders } from '../watch-folder-guard'

export class FileListTool implements ITool {
  private getConfig?: () => AppConfig

  constructor(getConfig?: () => AppConfig) {
    this.getConfig = getConfig
  }

  definition: ToolDefinition = {
    name: 'file_list',
    description: 'List files and subdirectories under watch folders.',
    parameters: {
      path: {
        type: 'string',
        description: 'Directory path to list',
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to recursively list subdirectories, default false',
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
      operationName: 'file_list',
    })
    if (!resolved.ok) {
      return { toolCallId: '', content: resolved.reason, isError: true }
    }
    const folderPath = resolved.path
    const recursive = Boolean(args.recursive)

    try {
      const stat = await fs.stat(folderPath).catch(() => null)
      if (!stat || !stat.isDirectory()) {
        return { toolCallId: '', content: `List failed: path is not a directory: ${folderPath}`, isError: true }
      }

      const items = await this.listDir(folderPath, recursive, 0)
      return { toolCallId: '', content: items.join('\n') }
    } catch (error) {
      return {
        toolCallId: '',
        content: `List files failed: ${error instanceof Error ? error.message : String(error)}`,
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
        if (recursive) {
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
