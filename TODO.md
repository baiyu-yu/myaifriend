# MyAIFriend TODO 与进度

## 项目目标
- 提供开箱即用的 Windows 单文件 `exe`
- 支持 GitHub 自动构建与发布
- 构建可落地的多模型 Agent 工作链（自动路由、上下文压缩、记忆管理）

## 已完成

### Phase 1 基础架构
- [x] Electron + Vue3 + Vite + TypeScript 初始化
- [x] 主进程 / 预加载 / 渲染进程 IPC 通信
- [x] 开发热重载

### Phase 2 配置系统
- [x] 统一配置模型 `AppConfig`
- [x] `electron-store` 持久化
- [x] API 配置管理
- [x] 角色设定
- [x] 模型路由配置

### Phase 3 对话核心
- [x] OpenAI 兼容 API 接入
- [x] 会话历史管理（新建/切换/重命名/删除/持久化）
- [x] Tool Calling 基础流程

### Phase 4 工具系统
- [x] 文件读写、目录列举、浏览器打开工具
- [x] Live2D 控制工具（事件分发）
- [x] 插件发现与基础安全校验

### Phase 5 桌面交互
- [x] 全局快捷键
- [x] 系统托盘
- [x] 悬浮聊天窗口
- [x] 文件夹监听触发
- [x] 随机定时触发
- [x] 退出流程修复

### Phase 6 Live2D
- [x] `pixi-live2d-display` 渲染接入
- [x] `.model3.json` 加载链路
- [x] 动作/表情映射（GUI 可编辑）

### Phase 7 GUI 设置
- [x] API/角色/路由/Live2D/文件夹/快捷键/工具列表/触发词页面
- [x] GUI 乱码与模板异常修复
- [x] 工作链设置页（自动路由、压缩、记忆）

### Phase 8 打包交付
- [x] electron-builder 配置
- [x] portable exe 打包脚本
- [x] 图标配置（`build/icon.png`）
- [x] GitHub Actions autobuild（push main）
- [x] Release 发布（tag `v*`）
- [x] 8.7 打包回归测试清单（安装、启动、退出、配置读写、工具调用）

### Phase 9 多模型 Agent 工作链
- [x] 自动任务识别（chat/summary/translation/file_operation/roleplay/tool_call/vision）
- [x] 模型路由到对应任务
- [x] 长上下文压缩（超阈值自动摘要）
- [x] 长期记忆管理（提取、检索、注入）

## 未完成（当前重点）

### 工程质量
- [ ] 增加关键链路自动化测试（IPC、配置、会话、打包后启动）
- [ ] 补充 AI 工作链回归测试（任务路由正确性、压缩触发、记忆注入）
- [ ] 建立最低可用 E2E 烟雾测试（启动、发送消息、保存配置、退出）

### 体验优化
- [ ] 在聊天 GUI 中增加“本次推理使用模型”可视化标记
- [ ] 在设置页增加“任务分类规则自定义”能力
- [ ] 记忆管理页面（查看/删除/清空记忆）
