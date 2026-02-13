import fs from 'fs/promises'
import path from 'path'
import mammoth from 'mammoth'
import ExcelJS from 'exceljs'
import { ITool } from '../tool-manager'
import { AppConfig, ToolDefinition, ToolResult } from '../../../common/types'
import { resolvePathInWatchFolders } from '../watch-folder-guard'

export class FileReadTool implements ITool {
  private getConfig?: () => AppConfig

  constructor(getConfig?: () => AppConfig) {
    this.getConfig = getConfig
  }

  definition: ToolDefinition = {
    name: 'file_read',
    description: 'Read file content under watch folders.',
    parameters: {
      path: {
        type: 'string',
        description: 'Full path or watch-folder-relative path to read',
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
      operationName: 'file_read',
    })
    if (!resolved.ok) {
      return { toolCallId: '', content: resolved.reason, isError: true }
    }
    const filePath = resolved.path
    const ext = path.extname(filePath).toLowerCase()

    try {
      let content: string

      switch (ext) {
        case '.txt':
        case '.html':
        case '.htm':
        case '.md':
        case '.json':
          content = await fs.readFile(filePath, 'utf-8')
          break

        case '.doc':
        case '.docx': {
          const buffer = await fs.readFile(filePath)
          const result = await mammoth.extractRawText({ buffer })
          content = result.value
          break
        }

        case '.xls':
        case '.xlsx': {
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.readFile(filePath)
          const sheets: string[] = []

          workbook.eachSheet((sheet) => {
            const rows: string[] = []
            rows.push(`=== Sheet: ${sheet.name} ===`)
            sheet.eachRow((row) => {
              const values = Array.isArray(row.values) ? row.values.slice(1).map((v) => String(v ?? '')) : []
              rows.push(values.join('\t'))
            })
            sheets.push(rows.join('\n'))
          })

          content = sheets.join('\n\n')
          break
        }

        case '.png':
        case '.jpg':
        case '.jpeg':
        case '.gif':
        case '.bmp':
        case '.webp': {
          const imgBuffer = await fs.readFile(filePath)
          const base64 = imgBuffer.toString('base64')
          content = `[Image file] ext=${ext}, bytes=${imgBuffer.length}, base64_len=${base64.length}`
          break
        }

        default:
          return {
            toolCallId: '',
            content: `Unsupported file extension for file_read: ${ext}`,
            isError: true,
          }
      }

      return { toolCallId: '', content }
    } catch (error) {
      return {
        toolCallId: '',
        content: `Read file failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }
}
