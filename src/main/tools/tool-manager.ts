import fs from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'
import { AppConfig, ToolDefinition, ToolParameter, ToolResult } from '../../common/types'
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

  private cloneToolParameter(parameter: ToolParameter): ToolParameter {
    return {
      ...parameter,
      ...(Array.isArray(parameter.enum) ? { enum: [...parameter.enum] } : {}),
      ...(parameter.items ? { items: this.cloneToolParameter(parameter.items) } : {}),
      ...(parameter.properties
        ? {
            properties: Object.fromEntries(
              Object.entries(parameter.properties).map(([key, value]) => [key, this.cloneToolParameter(value)])
            ),
          }
        : {}),
    }
  }

  private cloneToolDefinition(definition: ToolDefinition): ToolDefinition {
    return {
      ...definition,
      parameters: Object.fromEntries(
        Object.entries(definition.parameters || {}).map(([key, value]) => [key, this.cloneToolParameter(value)])
      ),
      required: definition.required ? [...definition.required] : [],
    }
  }

  private withRuntimeToolHints(definition: ToolDefinition): ToolDefinition {
    const cloned = this.cloneToolDefinition(definition)
    const config = this.getConfig?.()
    if (!config) return cloned

    if (cloned.name === 'live2d_control') {
      const expressionMap = config.live2dActionMap?.expression || {}
      const motionMap = config.live2dActionMap?.motion || {}
      const expressionOptions = Array.from(new Set([...Object.keys(expressionMap), ...Object.values(expressionMap)]))
        .map((item) => String(item || '').trim())
        .filter(Boolean)
      const motionOptions = Array.from(new Set([...Object.keys(motionMap), ...Object.values(motionMap)]))
        .map((item) => String(item || '').trim())
        .filter(Boolean)
      const allActionOptions = Array.from(new Set([...expressionOptions, ...motionOptions]))

      if (cloned.parameters.action_name) {
        cloned.parameters.action_name = {
          ...cloned.parameters.action_name,
          description: `${cloned.parameters.action_name.description}。当前映射 expression=${expressionOptions.length} 项，motion=${motionOptions.length} 项；优先从 enum 选择。`,
          ...(allActionOptions.length > 0 ? { enum: allActionOptions } : {}),
        }
      }
      if (cloned.parameters.action_type) {
        cloned.parameters.action_type = {
          ...cloned.parameters.action_type,
          description: `${cloned.parameters.action_type.description}。expression=表情，motion=动作。`,
        }
      }
      return cloned
    }

    if (cloned.name === 'file_write') {
      const watchFolders = (config.watchFolders || []).map((item) => String(item || '').trim()).filter(Boolean)
      cloned.description = `将内容写入监听文件夹中的文件（当前监听目录 ${watchFolders.length} 个）。`
      if (cloned.parameters.path) {
        cloned.parameters.path = {
          ...cloned.parameters.path,
          description:
            '目标文件路径。支持相对路径（将写入 watch_folder 对应监听目录）；也支持绝对路径（必须位于某个监听目录内）。',
        }
      }
      cloned.parameters.watch_folder = {
        type: 'string',
        description: '监听目录路径。配置多个监听目录时必须指定，并从 enum 中选择。',
        ...(watchFolders.length > 0 ? { enum: watchFolders } : {}),
      }
      const required = new Set(cloned.required || [])
      if (watchFolders.length > 1) {
        required.add('watch_folder')
      } else {
        required.delete('watch_folder')
      }
      cloned.required = Array.from(required)
      return cloned
    }

    if (cloned.name === 'open_in_browser') {
      const watchFolders = (config.watchFolders || []).map((item) => String(item || '').trim()).filter(Boolean)
      if (cloned.parameters.path) {
        cloned.parameters.path = {
          ...cloned.parameters.path,
          description:
            '目标 HTML 文件路径或 URL。对于本地文件，建议使用监听目录内相对路径，并在多监听目录时提供 watch_folder。',
        }
      }
      cloned.parameters.watch_folder = {
        type: 'string',
        description: '监听目录路径。配置多个监听目录时必须指定。',
        ...(watchFolders.length > 0 ? { enum: watchFolders } : {}),
      }
      const required = new Set(cloned.required || [])
      if (watchFolders.length > 1) {
        required.add('watch_folder')
      } else {
        required.delete('watch_folder')
      }
      cloned.required = Array.from(required)
      return cloned
    }

    return cloned
  }

  registerBuiltinTools(options?: {
    memoryManager?: MemoryManager
    conversationManager?: ConversationManager
  }): void {
    this.register(new FileReadTool())
    this.register(new FileWriteTool(this.getConfig))
    this.register(new FileListTool())
    this.register(new FileInfoTool())
    this.register(new OpenBrowserTool(this.getConfig))
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
      ...this.withRuntimeToolHints(t.definition),
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
