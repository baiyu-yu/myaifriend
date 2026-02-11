import { ToolDefinition, ToolResult } from '../../common/types'
import { FileReadTool } from './builtin/file-read'
import { FileWriteTool } from './builtin/file-write'
import { FileListTool } from './builtin/file-list'
import { OpenBrowserTool } from './builtin/open-browser'
import { Live2DControlTool } from './builtin/live2d-control'

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
