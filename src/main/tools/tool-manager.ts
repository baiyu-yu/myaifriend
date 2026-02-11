import { ToolDefinition, ToolResult } from '../../common/types'
import { FileReadTool } from './builtin/file-read'
import { FileWriteTool } from './builtin/file-write'
import { FileListTool } from './builtin/file-list'
import { OpenBrowserTool } from './builtin/open-browser'
import { Live2DControlTool } from './builtin/live2d-control'
import fs from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'

/** 所有工具需要实现此接口 */
export interface ITool {
  /** 工具定义 (用于 function calling) */
  definition: ToolDefinition
  /** 执行工具 */
  execute(args: Record<string, unknown>): Promise<ToolResult>
}

export class ToolManager {
  private tools: Map<string, ITool> = new Map()

  /** 注册一个工具 */
  register(tool: ITool): void {
    this.tools.set(tool.definition.name, tool)
  }

  /** 注销一个工具 */
  unregister(name: string): void {
    this.tools.delete(name)
  }

  /** 注册内置工具 */
  registerBuiltinTools(): void {
    this.register(new FileReadTool())
    this.register(new FileWriteTool())
    this.register(new FileListTool())
    this.register(new OpenBrowserTool())
    this.register(new Live2DControlTool())
  }

  /**
   * 自动发现并加载插件工具。
   * 约定：插件文件导出 default，且 default 为 ITool 或返回 ITool 的函数。
   */
  async discoverTools(pluginDir: string): Promise<{ loaded: number; errors: string[] }> {
    const errors: string[] = []
    let loaded = 0

    try {
      const entries = await fs.readdir(pluginDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const ext = path.extname(entry.name).toLowerCase()
        if (!['.js', '.cjs', '.mjs'].includes(ext)) continue

        const fullPath = path.join(pluginDir, entry.name)
        try {
          const mod = await import(pathToFileURL(fullPath).href)
          const candidate = mod.default
          const tool: ITool | null =
            typeof candidate === 'function' ? candidate() : candidate

          if (tool?.definition?.name && typeof tool.execute === 'function') {
            this.register(tool)
            loaded += 1
          } else {
            errors.push(`${entry.name}: 导出内容不符合 ITool 规范`)
          }
        } catch (error) {
          errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } catch (error) {
      errors.push(`读取插件目录失败: ${error instanceof Error ? error.message : String(error)}`)
    }

    return { loaded, errors }
  }

  /** 获取所有工具定义 (用于发送给 LLM) */
  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition)
  }

  /** 执行指定工具 */
  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return {
        toolCallId: '',
        content: `工具 "${name}" 不存在`,
        isError: true
      }
    }

    try {
      return await tool.execute(args)
    } catch (error) {
      return {
        toolCallId: '',
        content: `工具执行失败: ${error instanceof Error ? error.message : String(error)}`,
        isError: true
      }
    }
  }

  /** 获取已注册的工具数量 */
  get count(): number {
    return this.tools.size
  }
}
