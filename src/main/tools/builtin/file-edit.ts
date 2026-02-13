import fs from 'fs/promises'
import path from 'path'
import { ITool } from '../tool-manager'
import { AppConfig, ToolDefinition, ToolResult } from '../../../common/types'
import { resolvePathInWatchFolders } from '../watch-folder-guard'

type EditMode =
  | 'insert'
  | 'delete_range'
  | 'regex_delete'
  | 'regex_replace'
  | 'clear'
  | 'append'
  | 'replace_all'

function toSafeRegExp(pattern: string, flags: string): RegExp {
  const validFlags = Array.from(new Set(flags.split('').filter((flag) => 'gimsuy'.includes(flag)))).join('')
  return new RegExp(pattern, validFlags)
}

export class FileEditTool implements ITool {
  private getConfig?: () => AppConfig

  constructor(getConfig?: () => AppConfig) {
    this.getConfig = getConfig
  }

  definition: ToolDefinition = {
    name: 'file_edit',
    description: 'Edit text files under watch folders using insert/delete/regex/clear/append operations.',
    parameters: {
      path: {
        type: 'string',
        description: 'Target file path (inside watch folders)',
      },
      mode: {
        type: 'string',
        description: 'Edit mode',
        enum: ['insert', 'delete_range', 'regex_delete', 'regex_replace', 'clear', 'append', 'replace_all'],
      },
      content: {
        type: 'string',
        description: 'Content used by insert/append/replace_all/regex_replace',
      },
      index: {
        type: 'number',
        description: 'Character index for insert',
      },
      start: {
        type: 'number',
        description: 'Start index for delete_range',
      },
      end: {
        type: 'number',
        description: 'End index for delete_range (exclusive)',
      },
      pattern: {
        type: 'string',
        description: 'RegExp pattern for regex_delete/regex_replace',
      },
      flags: {
        type: 'string',
        description: 'RegExp flags for regex_delete/regex_replace, e.g. gmi',
      },
      watch_folder: {
        type: 'string',
        description: 'Watch folder path when multiple watch folders are configured',
      },
    },
    required: ['path', 'mode'],
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const resolved = resolvePathInWatchFolders({
      rawPath: String(args.path || ''),
      selectedWatchFolder: String(args.watch_folder || ''),
      watchFolders: this.getConfig?.().watchFolders || [],
      operationName: 'file_edit',
    })
    if (!resolved.ok) {
      return { toolCallId: '', content: resolved.reason, isError: true }
    }

    const filePath = resolved.path
    const ext = path.extname(filePath).toLowerCase()
    const editableTextExtensions = new Set(['.txt', '.md', '.html', '.htm', '.json', '.js', '.ts', '.css', '.vue'])
    if (!editableTextExtensions.has(ext)) {
      return {
        toolCallId: '',
        content: `Unsupported file extension for file_edit: ${ext}`,
        isError: true,
      }
    }

    const mode = String(args.mode || '').trim().toLowerCase() as EditMode
    const rawContent = String(args.content ?? '')
    const flags = String(args.flags || 'g')

    let text = await fs.readFile(filePath, 'utf-8').catch(() => '')
    const originalText = text

    try {
      if (mode === 'clear') {
        text = ''
      } else if (mode === 'append') {
        text = `${text}${rawContent}`
      } else if (mode === 'replace_all') {
        text = rawContent
      } else if (mode === 'insert') {
        const index = Math.max(0, Math.min(text.length, Number(args.index ?? text.length)))
        text = `${text.slice(0, index)}${rawContent}${text.slice(index)}`
      } else if (mode === 'delete_range') {
        const start = Math.max(0, Math.min(text.length, Number(args.start ?? 0)))
        const end = Math.max(start, Math.min(text.length, Number(args.end ?? text.length)))
        text = `${text.slice(0, start)}${text.slice(end)}`
      } else if (mode === 'regex_delete') {
        const pattern = String(args.pattern || '')
        if (!pattern) return { toolCallId: '', content: 'pattern is required for regex_delete', isError: true }
        text = text.replace(toSafeRegExp(pattern, flags), '')
      } else if (mode === 'regex_replace') {
        const pattern = String(args.pattern || '')
        if (!pattern) return { toolCallId: '', content: 'pattern is required for regex_replace', isError: true }
        text = text.replace(toSafeRegExp(pattern, flags), rawContent)
      } else {
        return { toolCallId: '', content: `Unsupported mode: ${mode}`, isError: true }
      }
    } catch (error) {
      return {
        toolCallId: '',
        content: `Edit transform failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, text, 'utf-8')
      const delta = text.length - originalText.length
      return {
        toolCallId: '',
        content: `Edit success: ${filePath} (mode=${mode}, delta=${delta}, length=${text.length})`,
      }
    } catch (error) {
      return {
        toolCallId: '',
        content: `Edit write failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }
}

