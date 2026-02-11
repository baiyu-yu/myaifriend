# MyAIFriend

基于 Electron + Vue 3 + TypeScript 的桌面 AI 助手项目，支持：
- 多模型 API 配置与路由
- 聊天窗口与会话历史持久化
- Tool Calling（内置文件工具/浏览器工具/Live2D 控制工具）
- 插件式工具自动发现（基础版）
- Live2D 桌宠窗口（当前为占位实现，未接入真实模型渲染）

## 1. 环境要求
- Node.js 20+
- npm 10+
- Windows（当前打包配置面向 Windows）

## 2. 安装与运行
```bash
npm install
```

开发模式（推荐）：
```bash
npm run dev:electron
```

仅前端开发：
```bash
npm run dev:renderer
```

构建：
```bash
npm run build
```

打包（Windows）：
```bash
npm run pack
```

## 3. 项目结构
```text
src/
  common/                 # 共享类型与默认配置
  main/                   # Electron 主进程
    ai/                   # LLM 调用与路由
    tools/                # 工具体系（内置+插件发现）
    config-manager.ts     # 配置持久化（electron-store）
    conversation-manager.ts # 会话持久化
    file-watcher.ts       # 文件夹监听
    index.ts              # 主进程入口
  preload/                # contextBridge API
  renderer/               # Vue 前端
    src/
      stores/             # Pinia 状态
      views/              # Chat / Settings / Live2D 页面
```

## 4. 已实现核心能力
- 配置系统：API、角色、模型路由、热键、监听目录等配置持久化
- 对话系统：会话创建/切换/重命名/删除，消息自动保存
- 工具系统：
  - `file_read`
  - `file_write`
  - `file_list`
  - `open_in_browser`
  - `live2d_control`
- 插件发现（基础版）：启动时扫描 `userData/tools` 下的插件文件

## 5. 工具插件开发（基础版）
主进程启动时会自动扫描：
- 目录：`app.getPath('userData')/tools`
- 文件后缀：`.js` / `.cjs` / `.mjs`

插件必须默认导出 `ITool` 实例或工厂函数。

示例：
```js
// hello-tool.js
export default {
  definition: {
    name: 'hello_tool',
    description: '返回一段问候文本',
    parameters: {
      name: { type: 'string', description: '姓名' }
    },
    required: ['name']
  },
  async execute(args) {
    return {
      toolCallId: '',
      content: `你好，${args.name}`
    }
  }
}
```

## 6. 主要 NPM 脚本
- `npm run dev:electron`：前后端联动开发
- `npm run build`：构建 renderer + main
- `npm run pack`：构建并执行 electron-builder

## 7. 当前限制与下一步
- Live2D 还未接入 `pixi-live2d-display` 的真实模型渲染
- 自动更新（Phase 8.3）未完成
- 插件机制当前仅基础版，尚未实现更完整的安全隔离与版本管理
