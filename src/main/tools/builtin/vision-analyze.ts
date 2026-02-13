import fs from 'fs/promises'
import path from 'path'
import { AppConfig, ToolDefinition, ToolResult } from '../../../common/types'
import { ITool } from '../tool-manager'

type ResolveImagePathResult =
  | { ok: true; imagePath: string; watchFolder: string }
  | { ok: false; reason: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mimeFromExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.bmp':
      return 'image/bmp'
    default:
      return ''
  }
}

function extractAssistantText(responsePayload: any): string {
  const content = responsePayload?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item
        if (isPlainObject(item) && typeof item.text === 'string') return item.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

export class VisionAnalyzeTool implements ITool {
  private getConfig?: () => AppConfig

  constructor(getConfig?: () => AppConfig) {
    this.getConfig = getConfig
  }

  definition: ToolDefinition = {
    name: 'vision_analyze',
    description: 'Analyze an image with the configured vision model (modelAssignments.vision).',
    parameters: {
      image_path: {
        type: 'string',
        description:
          'Image file path. Relative paths are resolved under watch_folder. Absolute paths must stay inside watch folders.',
      },
      prompt: {
        type: 'string',
        description: 'Question or instruction for the image. Default: describe the image and key details.',
      },
      watch_folder: {
        type: 'string',
        description: 'Watch folder path to resolve image_path when multiple watch folders exist.',
      },
    },
    required: ['image_path'],
  }

  private isPathInside(rootPath: string, targetPath: string): boolean {
    const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  private resolveImagePath(args: Record<string, unknown>): ResolveImagePathResult {
    const rawPath = String(args.image_path || '').trim()
    if (!rawPath) {
      return { ok: false, reason: 'image_path is required' }
    }

    const config = this.getConfig?.()
    const watchFolders = (config?.watchFolders || [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .map((folder) => path.resolve(folder))

    if (watchFolders.length === 0) {
      return {
        ok: false,
        reason: 'No watch folder configured. vision_analyze only reads images under watch folders.',
      }
    }

    const selectedWatchFolder = String(args.watch_folder || '').trim()
    let baseFolder = ''

    if (selectedWatchFolder) {
      const normalizedSelected = path.normalize(path.resolve(selectedWatchFolder)).toLowerCase()
      baseFolder =
        watchFolders.find((folder) => path.normalize(path.resolve(folder)).toLowerCase() === normalizedSelected) || ''
      if (!baseFolder) {
        return {
          ok: false,
          reason: `watch_folder is not configured: ${selectedWatchFolder}. Available: ${watchFolders.join(' | ')}`,
        }
      }
    } else if (!path.isAbsolute(rawPath) && watchFolders.length === 1) {
      baseFolder = watchFolders[0]
    }

    if (!baseFolder && !path.isAbsolute(rawPath) && watchFolders.length > 1) {
      return {
        ok: false,
        reason: `Multiple watch folders configured. Please specify watch_folder. Available: ${watchFolders.join(' | ')}`,
      }
    }

    const imagePath = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(baseFolder || watchFolders[0], rawPath)

    const inWatchFolders = watchFolders.some((folder) => this.isPathInside(folder, imagePath))
    if (!inWatchFolders) {
      return {
        ok: false,
        reason: `image_path is outside watch folders: ${imagePath}. Watch folders: ${watchFolders.join(' | ')}`,
      }
    }

    const matchedWatchFolder =
      baseFolder || watchFolders.find((folder) => this.isPathInside(folder, imagePath)) || watchFolders[0]

    return { ok: true, imagePath, watchFolder: matchedWatchFolder }
  }

  private resolveVisionModel(config: AppConfig): { baseUrl: string; apiKey: string; model: string } | null {
    const assignment = config.modelAssignments?.vision
    if (assignment?.apiConfigId && assignment?.model) {
      const api = config.apiConfigs.find((item) => item.id === assignment.apiConfigId)
      if (api) {
        return {
          baseUrl: api.baseUrl,
          apiKey: api.apiKey,
          model: assignment.model,
        }
      }
    }

    const fallback = config.apiConfigs[0]
    if (!fallback) return null

    const fallbackModel = assignment?.model || fallback.defaultModel
    if (!fallbackModel) return null

    return {
      baseUrl: fallback.baseUrl,
      apiKey: fallback.apiKey,
      model: fallbackModel,
    }
  }

  private buildRequestBody(model: string, prompt: string, imageDataUrl: string, config: AppConfig): Record<string, unknown> {
    const customBody = isPlainObject(config.modelRequestBody) ? { ...config.modelRequestBody } : {}
    delete customBody.messages

    return {
      ...customBody,
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a precise vision assistant. Use only image evidence and avoid hallucinations.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageDataUrl,
              },
            },
          ],
        },
      ],
    }
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const resolved = this.resolveImagePath(args)
    if (!resolved.ok) {
      return {
        toolCallId: '',
        content: resolved.reason,
        isError: true,
      }
    }

    const config = this.getConfig?.()
    if (!config) {
      return {
        toolCallId: '',
        content: 'Config is unavailable for vision_analyze.',
        isError: true,
      }
    }

    const route = this.resolveVisionModel(config)
    if (!route) {
      return {
        toolCallId: '',
        content: 'Vision model route is not configured. Please configure modelAssignments.vision and API settings.',
        isError: true,
      }
    }

    try {
      const imageBuffer = await fs.readFile(resolved.imagePath)
      const ext = path.extname(resolved.imagePath)
      const mime = mimeFromExtension(ext)
      if (!mime) {
        return {
          toolCallId: '',
          content: `Unsupported image format: ${ext}`,
          isError: true,
        }
      }

      const prompt =
        String(args.prompt || '').trim() ||
        'Describe the image, key objects, text content, scene context, and any notable anomalies.'

      const imageDataUrl = `data:${mime};base64,${imageBuffer.toString('base64')}`
      const requestBody = this.buildRequestBody(route.model, prompt, imageDataUrl, config)

      const response = await fetch(`${route.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${route.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return {
          toolCallId: '',
          content: `Vision request failed (${response.status}): ${errorText}`,
          isError: true,
        }
      }

      const payload = await response.json()
      const answer = extractAssistantText(payload)
      if (!answer.trim()) {
        return {
          toolCallId: '',
          content: 'Vision model returned empty content.',
          isError: true,
        }
      }

      return {
        toolCallId: '',
        content: `Vision analysis result:\n${answer}`,
      }
    } catch (error) {
      return {
        toolCallId: '',
        content: `Vision analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }
}

