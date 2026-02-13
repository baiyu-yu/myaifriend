import fs from 'fs/promises'
import path from 'path'
import ExcelJS from 'exceljs'
import { ITool } from '../tool-manager'
import { AppConfig, ToolDefinition, ToolResult } from '../../../common/types'

type ResolveTargetPathResult =
  | { ok: true; path: string; watchFolder: string }
  | { ok: false; reason: string }

export class FileWriteTool implements ITool {
  private getConfig?: () => AppConfig

  constructor(getConfig?: () => AppConfig) {
    this.getConfig = getConfig
  }

  definition: ToolDefinition = {
    name: 'file_write',
    description: 'Write content to files under configured watch folders. Supports txt/html/xlsx.',
    parameters: {
      path: {
        type: 'string',
        description:
          'Target file path. Relative paths are resolved under watch_folder. Absolute paths must stay inside a watch folder.',
      },
      content: {
        type: 'string',
        description:
          'Content to write. For xlsx, pass JSON like [{"sheet":"Sheet1","data":[["A1","B1"],["A2","B2"]]}].',
      },
      watch_folder: {
        type: 'string',
        description: 'Target watch folder. Required when multiple watch folders are configured unless path already implies one.',
      },
    },
    required: ['path', 'content'],
  }

  private normalizePathForCompare(input: string): string {
    return path.normalize(path.resolve(input)).toLowerCase()
  }

  private isPathInside(rootPath: string, targetPath: string): boolean {
    const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  private matchWatchFolderByName(watchFolders: string[], folderName: string): string[] {
    const name = folderName.trim().toLowerCase()
    if (!name) return []
    return watchFolders.filter((folder) => path.basename(folder).toLowerCase() === name)
  }

  private pickWatchFolderFromInput(watchFolders: string[], selectedWatchFolder: string): ResolveTargetPathResult | null {
    if (!selectedWatchFolder) return null

    const normalizedSelected = this.normalizePathForCompare(selectedWatchFolder)
    const exact = watchFolders.find((folder) => this.normalizePathForCompare(folder) === normalizedSelected)
    if (exact) {
      return {
        ok: true,
        path: '',
        watchFolder: exact,
      }
    }

    const byName = this.matchWatchFolderByName(watchFolders, selectedWatchFolder)
    if (byName.length === 1) {
      return {
        ok: true,
        path: '',
        watchFolder: byName[0],
      }
    }

    if (byName.length > 1) {
      return {
        ok: false,
        reason: `watch_folder name is ambiguous: ${selectedWatchFolder}. Candidates: ${byName.join(' | ')}`,
      }
    }

    return {
      ok: false,
      reason: `watch_folder is not configured: ${selectedWatchFolder}. Available: ${watchFolders.join(' | ')}`,
    }
  }

  private inferWatchFolderFromRelativePath(rawPath: string, watchFolders: string[]): {
    watchFolder: string | null
    relativePath: string
  } {
    const normalized = rawPath.replace(/\\/g, '/').replace(/^\.\//, '')
    const [head, ...rest] = normalized.split('/')
    if (!head) {
      return { watchFolder: null, relativePath: rawPath }
    }

    const byName = this.matchWatchFolderByName(watchFolders, head)
    if (byName.length === 1) {
      const nextRelativePath = rest.join('/')
      return {
        watchFolder: byName[0],
        relativePath: nextRelativePath || path.basename(rawPath),
      }
    }

    return { watchFolder: null, relativePath: rawPath }
  }

  private resolveTargetPath(args: Record<string, unknown>): ResolveTargetPathResult {
    const rawPath = String(args.path || '').trim()
    if (!rawPath) {
      return { ok: false, reason: 'path is required' }
    }

    const watchFolders = (this.getConfig?.().watchFolders || [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .map((folder) => path.resolve(folder))

    if (watchFolders.length === 0) {
      return {
        ok: false,
        reason: 'No watch folder configured. file_write only allows writing inside watch folders.',
      }
    }

    const selectedWatchFolder = String(args.watch_folder || '').trim()
    let baseFolder = ''
    let effectivePath = rawPath
    const looksRootRelativePath =
      /^[\\/]/.test(rawPath) && !/^[a-zA-Z]:[\\/]/.test(rawPath) && !rawPath.startsWith('\\\\')

    if (selectedWatchFolder) {
      const picked = this.pickWatchFolderFromInput(watchFolders, selectedWatchFolder)
      if (picked && !picked.ok) {
        return picked
      }
      baseFolder = picked?.watchFolder || ''
    }

    if (looksRootRelativePath) {
      effectivePath = rawPath.replace(/^[\\/]+/, '')
    } else if (path.isAbsolute(rawPath)) {
      const resolvedPath = path.resolve(rawPath)
      if (baseFolder) {
        if (!this.isPathInside(baseFolder, resolvedPath)) {
          return {
            ok: false,
            reason: `Target path is not inside selected watch_folder: ${baseFolder}`,
          }
        }
        return { ok: true, path: resolvedPath, watchFolder: baseFolder }
      }

      const candidates = watchFolders.filter((folder) => this.isPathInside(folder, resolvedPath))
      if (candidates.length === 0) {
        return {
          ok: false,
          reason: `Target path is outside watch folders: ${resolvedPath}. Watch folders: ${watchFolders.join(' | ')}`,
        }
      }
      const matchedFolder = candidates[0]
      return { ok: true, path: resolvedPath, watchFolder: matchedFolder }
    }

    if (!baseFolder) {
      if (watchFolders.length === 1) {
        baseFolder = watchFolders[0]
      } else {
        const inferred = this.inferWatchFolderFromRelativePath(rawPath, watchFolders)
        if (inferred.watchFolder) {
          baseFolder = inferred.watchFolder
          effectivePath = inferred.relativePath
        }
      }
    }

    if (!baseFolder) {
      return {
        ok: false,
        reason: `Multiple watch folders configured. Please specify watch_folder. Available: ${watchFolders.join(' | ')}`,
      }
    }

    const resolvedPath = path.resolve(baseFolder, effectivePath)
    if (!this.isPathInside(baseFolder, resolvedPath)) {
      return {
        ok: false,
        reason: `Target path escapes selected watch_folder: ${baseFolder}`,
      }
    }

    return {
      ok: true,
      path: resolvedPath,
      watchFolder: baseFolder,
    }
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const resolved = this.resolveTargetPath(args)
    if (!resolved.ok) {
      console.warn(
        '[tool:file_write][resolve_failed]',
        JSON.stringify(
          {
            input_path: String(args.path || ''),
            watch_folder: String(args.watch_folder || ''),
            reason: resolved.reason,
          },
          null,
          2
        )
      )
      return {
        toolCallId: '',
        content: resolved.reason,
        isError: true,
      }
    }

    const filePath = resolved.path
    const content = String(args.content ?? '')
    const ext = path.extname(filePath).toLowerCase()
    console.info(
      '[tool:file_write][resolved]',
      JSON.stringify(
        {
          input_path: String(args.path || ''),
          watch_folder: String(args.watch_folder || ''),
          resolved_path: filePath,
          resolved_watch_folder: resolved.watchFolder,
          extension: ext,
        },
        null,
        2
      )
    )

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true })

      switch (ext) {
        case '.txt':
        case '.html':
        case '.htm':
          await fs.writeFile(filePath, content, 'utf-8')
          break

        case '.xlsx': {
          const workbook = new ExcelJS.Workbook()
          const sheetData = JSON.parse(content) as Array<{ sheet: string; data: string[][] }>
          for (const sheetItem of sheetData) {
            const sheet = workbook.addWorksheet(sheetItem.sheet)
            for (const row of sheetItem.data) {
              sheet.addRow(row)
            }
          }
          await workbook.xlsx.writeFile(filePath)
          break
        }

        default:
          return {
            toolCallId: '',
            content: `Unsupported file extension for file_write: ${ext}`,
            isError: true,
          }
      }

      const relativeToWatchFolder = path.relative(resolved.watchFolder, filePath)
      console.info(
        '[tool:file_write][success]',
        JSON.stringify(
          {
            file_path: filePath,
            watch_folder: resolved.watchFolder,
            relative_path: relativeToWatchFolder,
          },
          null,
          2
        )
      )
      return {
        toolCallId: '',
        content: `Write success: ${filePath} (watch_folder=${resolved.watchFolder}, relative=${relativeToWatchFolder})`,
      }
    } catch (error) {
      console.error(
        '[tool:file_write][error]',
        JSON.stringify(
          {
            file_path: filePath,
            watch_folder: resolved.watchFolder,
            message: error instanceof Error ? error.message : String(error),
          },
          null,
          2
        )
      )
      return {
        toolCallId: '',
        content: `Write failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }
}

