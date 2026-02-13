import fs from 'fs/promises'
import path from 'path'
import ExcelJS from 'exceljs'
import { ITool } from '../tool-manager'
import { AppConfig, ToolDefinition, ToolResult } from '../../../common/types'

export class FileWriteTool implements ITool {
  private getConfig?: () => AppConfig

  constructor(getConfig?: () => AppConfig) {
    this.getConfig = getConfig
  }

  definition: ToolDefinition = {
    name: 'file_write',
    description: '将内容写入监听文件夹中的文件，支持 txt/html/xlsx。',
    parameters: {
      path: {
        type: 'string',
        description: '目标文件路径（相对路径会基于 watch_folder 解析）',
      },
      content: {
        type: 'string',
        description:
          '写入内容。对于 xlsx，使用 JSON 字符串，例如 [{"sheet":"Sheet1","data":[["A1","B1"],["A2","B2"]]}]',
      },
      watch_folder: {
        type: 'string',
        description: '监听目录路径。配置多个监听目录时建议必填。',
      },
    },
    required: ['path', 'content'],
  }

  private isPathInside(rootPath: string, targetPath: string): boolean {
    const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  private resolveTargetPath(args: Record<string, unknown>): { ok: true; path: string } | { ok: false; reason: string } {
    const rawPath = String(args.path || '').trim()
    if (!rawPath) {
      return { ok: false, reason: '参数 path 不能为空' }
    }
    const watchFolders = (this.getConfig?.().watchFolders || [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    if (watchFolders.length === 0) {
      return { ok: false, reason: '未配置监听目录，file_write 仅允许写入监听目录内文件。' }
    }

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

    const resolvedPath = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(path.resolve(baseFolder || watchFolders[0]), rawPath)
    const inWatchFolders = watchFolders.some((folder) => this.isPathInside(folder, resolvedPath))
    if (!inWatchFolders) {
      return {
        ok: false,
        reason: `目标路径不在监听目录内: ${resolvedPath}，监听目录: ${watchFolders.join(' | ')}`,
      }
    }
    if (baseFolder && !this.isPathInside(baseFolder, resolvedPath)) {
      return {
        ok: false,
        reason: `目标路径不在指定 watch_folder 内: ${baseFolder}`,
      }
    }

    return { ok: true, path: resolvedPath }
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const resolved = this.resolveTargetPath(args)
    if (!resolved.ok) {
      return {
        toolCallId: '',
        content: resolved.reason,
        isError: true,
      }
    }
    const filePath = resolved.path
    const content = String(args.content ?? '')
    const ext = path.extname(filePath).toLowerCase()

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
          for (const s of sheetData) {
            const sheet = workbook.addWorksheet(s.sheet)
            for (const row of s.data) {
              sheet.addRow(row)
            }
          }
          await workbook.xlsx.writeFile(filePath)
          break
        }

        default:
          return {
            toolCallId: '',
            content: `不支持写入此文件格式: ${ext}`,
            isError: true,
          }
      }

      return { toolCallId: '', content: `文件写入成功: ${filePath}` }
    } catch (error) {
      return {
        toolCallId: '',
        content: `写入文件失败: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }
}
