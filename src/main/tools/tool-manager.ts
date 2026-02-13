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
import { VisionAnalyzeTool } from './builtin/vision-analyze'
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
          description: `${cloned.parameters.action_name.description} (expression=${expressionOptions.length}, motion=${motionOptions.length})`,
          ...(allActionOptions.length > 0 ? { enum: allActionOptions } : {}),
        }
      }
      return cloned
    }

    if (cloned.name === 'file_write') {
      const watchFolders = (config.watchFolders || []).map((item) => String(item || '').trim()).filter(Boolean)
      cloned.description = `Write content to files under watch folders (configured=${watchFolders.length}).`
      if (cloned.parameters.path) {
        cloned.parameters.path = {
          ...cloned.parameters.path,
          description:
            'Target file path. Relative paths resolve under watch_folder. Absolute paths must remain inside a watch folder.',
        }
      }
      cloned.parameters.watch_folder = {
        type: 'string',
        description: 'Watch folder path. Required when multiple watch folders are configured.',
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
            'Target HTML file path or URL. For local files, prefer relative paths inside watch folders and provide watch_folder when needed.',
        }
      }
      cloned.parameters.watch_folder = {
        type: 'string',
        description: 'Watch folder path. Required when multiple watch folders are configured.',
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

    if (cloned.name === 'vision_analyze') {
      const watchFolders = (config.watchFolders || []).map((item) => String(item || '').trim()).filter(Boolean)
      cloned.description = `Analyze image with vision model assignment (watchFolders=${watchFolders.length}).`
      cloned.parameters.watch_folder = {
        type: 'string',
        description: 'Watch folder path used to resolve image_path.',
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
    this.register(new VisionAnalyzeTool(this.getConfig))
    this.register(new WebSearchTool(this.getConfig))
    if (options?.memoryManager) {
      this.register(new MemorySearchTool(options.memoryManager))
    }
    if (options?.conversationManager) {
      this.register(new ConversationSearchTool(options.conversationManager))
    }
  }

  /**
   * Basic plugin safety policy (not a full sandbox):
   * 1) only .js/.cjs/.mjs files
   * 2) file name must include .tool.
   * 3) file size <= 2MB
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
          errors.push(`${entry.name}: file too large, rejected (>2MB)`)
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
            errors.push(`${entry.name}: exported object does not match ITool contract`)
          }
        } catch (error) {
          errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } catch (error) {
      errors.push(`Failed to read plugin directory: ${error instanceof Error ? error.message : String(error)}`)
    }

    return { loaded, errors }
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => ({
      ...this.withRuntimeToolHints(tool.definition),
      enabled: this.isToolEnabled(tool.definition.name),
    }))
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return {
        toolCallId: '',
        content: `Tool "${name}" not found`,
        isError: true,
      }
    }
    if (!this.isToolEnabled(name)) {
      return {
        toolCallId: '',
        content: `Tool "${name}" is disabled by settings`,
        isError: true,
      }
    }

    try {
      return await tool.execute(args)
    } catch (error) {
      return {
        toolCallId: '',
        content: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }

  get count(): number {
    return this.tools.size
  }
}

