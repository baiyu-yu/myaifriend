import { shell } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { ITool } from '../tool-manager'
import { AppConfig, ToolDefinition, ToolResult } from '../../../common/types'

export class OpenBrowserTool implements ITool {
  private getConfig?: () => AppConfig

  constructor(getConfig?: () => AppConfig) {
    this.getConfig = getConfig
  }

  definition: ToolDefinition = {
    name: 'open_in_browser',
    description: '使用系统默认浏览器打开 HTML 文件或 URL。',
    parameters: {
      path: {
        type: 'string',
        description: '目标 HTML 文件路径或 URL（相对路径会基于 watch_folder 解析）',
      },
      watch_folder: {
        type: 'string',
        description: '监听目录路径。配置多个监听目录时建议显式指定。',
      },
    },
    required: ['path'],
  }

  private isPathInside(rootPath: string, targetPath: string): boolean {
    const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  private resolveLocalPath(args: Record<string, unknown>): { ok: true; path: string } | { ok: false; reason: string } {
    const rawPath = String(args.path || '').trim()
    if (!rawPath) {
      return { ok: false, reason: '参数 path 不能为空' }
    }
    if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
      return { ok: true, path: rawPath }
    }

    const watchFolders = (this.getConfig?.().watchFolders || [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    const selectedWatchFolder = String(args.watch_folder || '').trim()

    let baseFolder = ''
    if (selectedWatchFolder) {
      const normalizedSelected = path.resolve(selectedWatchFolder)
      baseFolder =
        watchFolders.find(
          (folder) => path.normalize(path.resolve(folder)).toLowerCase() === path.normalize(normalizedSelected).toLowerCase()
        ) || ''
      if (!baseFolder) {
        return {
          ok: false,
          reason: `watch_folder 不在监听目录列表中，可选值: ${watchFolders.join(' | ')}`,
        }
      }
    } else if (!path.isAbsolute(rawPath) && watchFolders.length === 1) {
      baseFolder = watchFolders[0]
    }

    if (!baseFolder && watchFolders.length > 1) {
      return {
        ok: false,
        reason: `存在多个监听目录，请指定 watch_folder。可选值: ${watchFolders.join(' | ')}`,
      }
    }

    const resolved = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(path.resolve(baseFolder || process.cwd()), rawPath)

    if (watchFolders.length > 0) {
      const inWatchFolders = watchFolders.some((folder) => this.isPathInside(folder, resolved))
      if (!inWatchFolders) {
        return {
          ok: false,
          reason: `目标路径不在监听目录内: ${resolved}，监听目录: ${watchFolders.join(' | ')}`,
        }
      }
      if (baseFolder && !this.isPathInside(baseFolder, resolved)) {
        return {
          ok: false,
          reason: `目标路径不在指定 watch_folder 内: ${baseFolder}`,
        }
      }
    }

    return { ok: true, path: resolved }
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const resolved = this.resolveLocalPath(args)
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
            content: `打开失败: 文件不存在或不是文件 ${targetPath}`,
            isError: true,
          }
        }
        const openError = await shell.openPath(targetPath)
        if (openError) {
          return {
            toolCallId: '',
            content: `打开失败: ${openError}`,
            isError: true,
          }
        }
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
