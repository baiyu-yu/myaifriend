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
    const actionType = args.action_type as 'expression' | 'motion'
    const actionName = args.action_name as string
    const priority = (args.priority as number) || 2

    const action: Live2DAction = {
      type: actionType,
      name: actionName,
      priority,
    }

    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send(IPC_CHANNELS.LIVE2D_ACTION, action)
    }

    return {
      toolCallId: '',
      content: `已发送 Live2D 动作: ${actionType} - ${actionName}`,
    }
  }
}
