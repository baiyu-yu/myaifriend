# MyAIFriend

一个基于 Electron + Vue 3 + TypeScript 的桌面 AI 助手。

## 目标能力
- 可直接分发的 Windows 单文件 `exe`（portable）
- 多模型 API 配置与任务路由
- 会话历史持久化（新建、切换、重命名、删除）
- Tool Calling（文件读写、目录列举、浏览器打开、Live2D 控制）
- GitHub Actions 自动构建（autobuild）与标签发布

## 环境要求（仅开发者）
- Node.js 20+
- npm 10+
- Windows（当前打包目标）

普通用户不需要安装 Node 或配置开发环境，只需下载构建出的 `exe` 运行。

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

## 打包说明

### 1) 生成单文件 exe（默认）
```bash
npm run pack
```
或：
```bash
npm run pack:portable
```

输出目录：
- `release/*.exe`

### 2) 生成安装包（可选）
```bash
npm run pack:installer
```

## GitHub 自动构建（autobuild）
工作流文件：
- `.github/workflows/autobuild-windows.yml`

触发规则：
- 推送到 `main`：自动构建 portable exe，并上传到 Actions Artifacts
- 推送标签 `v*`（例如 `v1.0.1`）：自动构建并上传到 GitHub Release
- 支持手动触发（`workflow_dispatch`）

标签发布示例：
```bash
git tag v1.0.1
git push origin v1.0.1
```

## 项目结构
```text
src/
  common/                     # 共享类型与默认配置
  main/                       # Electron 主进程
    ai/                       # LLM 调用与路由
    tools/                    # 工具体系（内置 + 插件发现）
    config-manager.ts         # 配置持久化
    conversation-manager.ts   # 会话持久化
    file-watcher.ts           # 文件监听
    index.ts                  # 主进程入口
  preload/                    # contextBridge API
  renderer/                   # Vue 前端
    src/
      stores/                 # Pinia 状态
      views/                  # Chat / Settings / Live2D
```

## 插件工具（基础版）
启动时会扫描：
- `app.getPath('userData')/tools`
- 后缀：`.js` / `.cjs` / `.mjs`

插件默认导出 `ITool` 实例或工厂函数。

## 当前未完成
- 真实 Live2D 渲染与 `.moc3` 模型联动
- 自动更新机制（应用内升级）
- 插件系统的安全隔离与签名校验
