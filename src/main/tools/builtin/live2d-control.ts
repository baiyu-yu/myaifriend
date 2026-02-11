import { BrowserWindow } from 'electron'
import { ITool } from '../tool-manager'
import { IPC_CHANNELS, Live2DAction, ToolDefinition, ToolResult } from '../../../common/types'

export class Live2DControlTool implements ITool {
  definition: ToolDefinition = {
    name: 'live2d_control',
    description: '控制桌面 Live2D 角色的表情和动作。',
    parameters: {
      action_type: {
        type: 'string',
        description: '动作类型',
        enum: ['expression', 'motion'],
      },
      action_name: {
        type: 'string',
        description: '表情或动作名称，具体取值由当前模型决定',
      },
      priority: {
        type: 'number',
        description: '动作优先级（1=闲置, 2=普通, 3=强制），默认 2',
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
