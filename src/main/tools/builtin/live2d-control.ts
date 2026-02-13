import { BrowserWindow } from 'electron'
import { ITool } from '../tool-manager'
import { IPC_CHANNELS, Live2DAction, ToolDefinition, ToolResult } from '../../../common/types'

export class Live2DControlTool implements ITool {
  definition: ToolDefinition = {
    name: 'live2d_control',
    description:
      '控制桌面 Live2D 角色表情/动作。action_name 支持别名，实际名称会按设置中的 Live2D 映射表转换。',
    parameters: {
      action_type: {
        type: 'string',
        description: '动作类型',
        enum: ['expression', 'motion'],
      },
      action_name: {
        type: 'string',
        description: '动作或表情名称（支持自定义别名）',
      },
      priority: {
        type: 'number',
        description: '动作优先级（1=闲置, 2=普通, 3=强制）',
      },
    },
    required: ['action_type', 'action_name'],
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const normalizedType = String(args.action_type || args.type || '')
      .trim()
      .toLowerCase()
    if (normalizedType !== 'expression' && normalizedType !== 'motion') {
      return {
        toolCallId: '',
        content: '参数 action_type 无效，可选值: expression | motion',
        isError: true,
      }
    }
    const actionType = normalizedType as 'expression' | 'motion'
    const actionName = String(args.action_name || args.name || '').trim()
    if (!actionName) {
      return {
        toolCallId: '',
        content: '参数 action_name 不能为空',
        isError: true,
      }
    }
    const rawPriority = Number(args.priority)
    const priority = Number.isFinite(rawPriority) ? Math.max(1, Math.min(3, Math.round(rawPriority))) : 2

    const action: Live2DAction = {
      type: actionType,
      name: actionName,
      priority,
    }

    const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
    const live2dWindows = windows.filter((win) => {
      const url = win.webContents.getURL() || ''
      return url.includes('#/live2d')
    })
    if (live2dWindows.length === 0) {
      return {
        toolCallId: '',
        content: '未找到可用的 Live2D 窗口，请先显示 Live2D。',
        isError: true,
      }
    }

    for (const win of live2dWindows) {
      win.webContents.send(IPC_CHANNELS.LIVE2D_ACTION, action)
    }

    return {
      toolCallId: '',
      content: `已发送 Live2D 动作: ${actionType} - ${actionName}（目标窗口 ${live2dWindows.length} 个）`,
    }
  }
}
