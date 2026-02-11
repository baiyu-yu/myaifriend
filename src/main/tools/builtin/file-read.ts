import fs from 'fs/promises'
import path from 'path'
import mammoth from 'mammoth'
import ExcelJS from 'exceljs'
import { ITool } from '../tool-manager'
import { ToolDefinition, ToolResult } from '../../../common/types'

export class FileReadTool implements ITool {
  definition: ToolDefinition = {
    name: 'file_read',
    description: '读取指定文件内容，支持 txt/doc/docx/xls/xlsx/html 与常见图片格式。',
    parameters: {
      path: {
        type: 'string',
        description: '要读取的文件完整路径',
      },
    },
    required: ['path'],
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = args.path as string
    const ext = path.extname(filePath).toLowerCase()

    try {
      let content: string

      switch (ext) {
        case '.txt':
        case '.html':
        case '.htm':
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
          content = `[图片文件] 格式: ${ext}, 大小: ${imgBuffer.length} bytes, Base64长度: ${base64.length}`
          break
        }

        default:
          content = `不支持的文件格式: ${ext}`
      }

      return { toolCallId: '', content }
    } catch (error) {
      return {
        toolCallId: '',
        content: `读取文件失败: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }
}
