# MyAIFriend

基于 Electron + Vue3 + TypeScript 的桌面 AI 助手，支持多模型路由、工具调用、会话持久化与 Live2D 交互。

## 核心能力
- Windows 单文件 `portable exe` 打包发布
- 多模型路由：按任务类型选择不同模型（普通对话/总结/翻译/视觉等）
- Agent 工作链：
  - 自动任务识别与路由
  - 长上下文自动压缩
  - 长期记忆注入（偏好/身份/习惯）
- Tool Calling（文件、目录、浏览器、Live2D 控制）
- 会话历史持久化（新建、切换、重命名、删除）
- GitHub Actions 自动构建与 Release 发布

## 技术栈
- Electron
- Vue 3 + Vite
- TypeScript
- Element Plus
- electron-builder

## 开发环境
- Node.js 20+
- npm 10+
- Windows（打包目标为 Windows）

## 本地开发
```bash
npm install
npm run dev:electron
```

## 类型检查
```bash
npx tsc -p tsconfig.main.json --noEmit
npx vue-tsc -p tsconfig.renderer.json --noEmit
```

## 打包
默认单文件便携版：
```bash
npm run pack
```

显式便携版：
```bash
npm run pack:portable
```

安装包（可选）：
```bash
npm run pack:installer
```

产物目录：
- `release/*.exe`

图标文件：
- `build/icon.png`

## GitHub 自动构建（autobuild）
工作流：
- `.github/workflows/autobuild-windows.yml`

触发方式：
- `push main`：自动构建 portable exe 并上传 artifact
- `tag v*`：自动构建并上传 GitHub Release 资产
- `workflow_dispatch`：手动触发

示例：
```bash
git tag v1.0.1
git push origin v1.0.1
```

## 多模型与工作链配置说明
在“设置 -> 模型路由 / 工作链”中配置：
- 为 `chat / summary / translation / vision` 配置不同模型
- 打开“自动任务路由”
- 打开“上下文压缩”（并设置阈值）
- 打开“长期记忆”（并设置注入条数与上限）

推荐策略：
1. `chat` 使用性价比模型
2. `summary` 使用便宜且稳定的长文本模型
3. `translation` 使用专门翻译模型
4. `vision` 使用多模态模型

## AI 协作规范
请阅读 `docs/ai-collab-rules.md`。  
其中包含“每次修改后执行 git add/commit/push 同步远程仓库”的规范流程。

## Local Mock API (for cost-free testing)
- Start: `npm run mock:api`
- Endpoint: `http://127.0.0.1:8787/v1/chat/completions`
- Setup guide: `docs/mock-api-server.md`
