import fs from 'fs/promises'
import path from 'path'
import ExcelJS from 'exceljs'
import { ITool } from '../tool-manager'
import { ToolDefinition, ToolResult } from '../../../common/types'

export class FileWriteTool implements ITool {
  definition: ToolDefinition = {
    name: 'file_write',
    description: '写入内容到指定路径的文件。支持 txt、html 和 excel 文件。',
    parameters: {
      path: {
        type: 'string',
        description: '要写入的文件完整路径'
      },
      content: {
        type: 'string',
        description: '要写入的内容。对于 excel 文件,使用 JSON 格式: [{"sheet":"Sheet1","data":[["A1","B1"],["A2","B2"]]}]'
      }
    },
    required: ['path', 'content']
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = args.path as string
    const content = args.content as string
    const ext = path.extname(filePath).toLowerCase()

    try {
      // 确保目录存在
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
            isError: true
          }
      }

      return { toolCallId: '', content: `文件已成功写入: ${filePath}` }
    } catch (error) {
      return {
        toolCallId: '',
        content: `写入文件失败: ${error instanceof Error ? error.message : String(error)}`,
        isError: true
      }
    }
  }
}
