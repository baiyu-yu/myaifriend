# MyAIFriend

基于 Electron + Vue 3 + TypeScript 的桌面 AI 助手。

## 核心能力
- Windows 单文件 `portable exe` 分发
- API 配置与模型路由
- 会话历史持久化（新建、切换、重命名、删除）
- Tool Calling（文件、目录、浏览器、Live2D 控制）
- Live2D 动作/表情映射表（设置页可编辑）
- GitHub Actions 自动构建与标签发布

## 环境要求（开发）
- Node.js 20+
- npm 10+
- Windows

普通用户无需安装 Node，只需下载构建好的 `exe` 即可运行。

## 本地开发
安装依赖：
```bash
npm install
```

启动开发：
```bash
npm run dev:electron
```

类型检查：
```bash
npx tsc -p tsconfig.main.json --noEmit
npx vue-tsc -p tsconfig.renderer.json --noEmit
```

## 打包

默认单文件 exe：
```bash
npm run pack
```

显式 portable：
```bash
npm run pack:portable
```

安装包（可选）：
```bash
npm run pack:installer
```

产物目录：
- `release/*.exe`

程序图标占位文件：
- `build/icon.png`

## GitHub 自动构建（autobuild）
工作流：
- `.github/workflows/autobuild-windows.yml`

触发：
- `push main`：自动构建 portable exe 并上传 Artifact
- `tag v*`：自动构建并上传 GitHub Release 资产
- 手动触发：`workflow_dispatch`

标签发布示例：
```bash
git tag v1.0.1
git push origin v1.0.1
```

## 插件工具（基础版）
扫描目录：
- `app.getPath('userData')/tools`

支持后缀：
- `.js` / `.cjs` / `.mjs`

基础安全策略：
- 文件名需包含 `.tool.`
- 单文件大小上限 2MB
- 默认导出需符合 `ITool`

## 当前未完成重点
- Live2D 真实渲染与 `.moc3` 模型链路
- AI 驱动真实表情/动作映射
- 应用内自动更新（运行时升级）
- 插件系统更完整的隔离与签名校验
