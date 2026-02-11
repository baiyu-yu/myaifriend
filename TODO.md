# MyAIFriend - 待办与进度

## 目标
- 提供开箱即用的 Windows 单文件 `exe`（用户无需安装开发环境）
- 支持 GitHub 自动构建与自动发布
- 持续完善 Live2D、插件安全和自动更新能力

## 已完成

### Phase 1 基础架构
- [x] Electron + Vue3 + Vite + TypeScript 初始化
- [x] 主进程 / 预加载 / 渲染进程 IPC 通信
- [x] 开发热重载
- [x] 项目目录规范

### Phase 2 配置系统
- [x] 统一配置模型（`AppConfig`）
- [x] `electron-store` 持久化
- [x] API 配置管理（URL/Token/默认模型）
- [x] 角色设定（system prompt）
- [x] 模型路由配置

### Phase 3 对话核心
- [x] OpenAI 兼容 API 适配
- [x] 会话历史管理（创建/切换/重命名/删除/持久化）
- [x] 任务类型模型路由
- [x] Tool Calling 基础流程
- [x] 工具注册与插件发现（基础版）

### Phase 4 工具系统
- [x] `ITool` 接口规范
- [x] 文件读取工具（txt/doc/docx/xlsx/html/图片信息）
- [x] 文件写入工具（txt/html/xlsx）
- [x] 目录列举工具
- [x] 浏览器打开工具
- [x] Live2D 控制工具（事件派发）
- [x] 插件安全校验（基础版：后缀限制/命名约束/大小限制）

### Phase 5 桌面交互
- [x] 全局快捷键
- [x] 系统托盘
- [x] 悬浮聊天窗口
- [x] 文件夹监听（chokidar）
- [x] 多触发源提示词拼接
- [x] 修复退出逻辑（托盘“退出程序”可正常关闭进程）

### Phase 7 GUI 设置
- [x] 设置主页面
- [x] API 配置页
- [x] 角色设定页
- [x] 路由配置页
- [x] Live2D 设置页
- [x] 文件夹监听页
- [x] 快捷键页
- [x] 工具列表页

### Phase 8 打包交付
- [x] electron-builder 配置
- [x] 单文件 `portable exe` 打包脚本
- [x] 程序图标占位（`build/icon.png`）
- [x] GitHub Actions autobuild（push main 自动构建 artifact）
- [x] GitHub 标签发布（`v*` 自动上传 Release）

## 未完成（当前重点）

### Phase 6 Live2D
- [x] 6.1 接入 `pixi-live2d-display` 真实渲染（基础版）
- [x] 6.2 支持 `.model3.json` / `.moc3` 模型链路（基础版）
- [x] 6.3 AI 驱动动作/表情映射（GUI 可编辑，基础版）

### Phase 8 交付完善
- [ ] 8.6 应用内自动更新（非 CI，运行时升级）
- [ ] 8.7 打包回归测试清单（安装、启动、退出、配置读写、工具调用）

### 工程质量
- [ ] 增加关键链路自动化测试（IPC、配置、会话、打包后启动）
