import fs from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'
import { AppConfig, ToolDefinition, ToolResult } from '../../common/types'
import { FileReadTool } from './builtin/file-read'
import { FileWriteTool } from './builtin/file-write'
import { FileListTool } from './builtin/file-list'
import { FileInfoTool } from './builtin/file-info'
import { OpenBrowserTool } from './builtin/open-browser'
import { Live2DControlTool } from './builtin/live2d-control'
import { WebSearchTool } from './builtin/web-search'
import { MemorySearchTool } from './builtin/memory-search'
import { ConversationSearchTool } from './builtin/conversation-search'
import { MemoryManager } from '../ai/memory-manager'
import { ConversationManager } from '../conversation-manager'

export interface ITool {
  definition: ToolDefinition
  execute(args: Record<string, unknown>): Promise<ToolResult>
}

export class ToolManager {
  private tools: Map<string, ITool> = new Map()
  private getConfig?: () => AppConfig

  constructor(getConfig?: () => AppConfig) {
    this.getConfig = getConfig
  }

  register(tool: ITool): void {
    this.tools.set(tool.definition.name, tool)
  }

  unregister(name: string): void {
    this.tools.delete(name)
  }

  private isToolEnabled(name: string): boolean {
    const config = this.getConfig?.()
    const toggles = config?.toolToggles
    if (
      config &&
      config.memoryLayers &&
      config.memoryLayers.activeRecallEnabled === false &&
      (name === 'memory_search' || name === 'conversation_search')
    ) {
      return false
    }
    if (!toggles) return true
    return toggles[name] !== false
  }

  registerBuiltinTools(options?: {
    memoryManager?: MemoryManager
    conversationManager?: ConversationManager
  }): void {
    this.register(new FileReadTool())
    this.register(new FileWriteTool())
    this.register(new FileListTool())
    this.register(new FileInfoTool())
    this.register(new OpenBrowserTool())
    this.register(new Live2DControlTool())
    this.register(new WebSearchTool(this.getConfig))
    if (options?.memoryManager) {
      this.register(new MemorySearchTool(options.memoryManager))
    }
    if (options?.conversationManager) {
      this.register(new ConversationSearchTool(options.conversationManager))
    }
  }

  /**
   * 基础安全校验策略（未做沙箱）：
   * 1. 仅允许 .js/.cjs/.mjs
   * 2. 文件名需包含 .tool.
   * 3. 文件大小上限 2MB
   */
  async discoverTools(pluginDir: string): Promise<{ loaded: number; errors: string[] }> {
    const errors: string[] = []
    let loaded = 0

    try {
      await fs.mkdir(pluginDir, { recursive: true })
      const entries = await fs.readdir(pluginDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue

        const ext = path.extname(entry.name).toLowerCase()
        if (!['.js', '.cjs', '.mjs'].includes(ext)) continue
        if (!entry.name.includes('.tool.')) continue

        const fullPath = path.join(pluginDir, entry.name)
        const stat = await fs.stat(fullPath)
        if (stat.size > 2 * 1024 * 1024) {
          errors.push(`${entry.name}: 文件过大，已拒绝加载（>2MB）`)
          continue
        }

        try {
          const mod = await import(pathToFileURL(fullPath).href)
          const candidate = mod.default
          const tool: ITool | null = typeof candidate === 'function' ? candidate() : candidate

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

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => ({
      ...t.definition,
      enabled: this.isToolEnabled(t.definition.name),
    }))
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return {
        toolCallId: '',
        content: `工具 "${name}" 不存在`,
        isError: true,
      }
    }
    if (!this.isToolEnabled(name)) {
      return {
        toolCallId: '',
        content: `工具 "${name}" 已在设置中禁用`,
        isError: true,
      }
    }

    try {
      return await tool.execute(args)
    } catch (error) {
      return {
        toolCallId: '',
        content: `工具执行失败: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }

  get count(): number {
    return this.tools.size
  }
}
