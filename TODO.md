# MyAIFriend - 项目待办与完成进度

## 目标定义
- 提供可直接运行的 Windows 单文件 `exe`（不要求用户安装开发环境）
- 支持 GitHub 自动构建 autobuild 版本
- 完成 AI 对话、工具调用、配置管理与基础桌面交互

---

## Phase 1：基础架构
- [x] 1.1 Electron + Vue3 + Vite + TypeScript 初始化
- [x] 1.2 主进程 / 预加载 / 渲染进程 IPC 通信
- [x] 1.3 开发热重载流程
- [x] 1.4 目录结构规范

## Phase 2：配置系统
- [x] 2.1 统一配置模型（`AppConfig`）
- [x] 2.2 `electron-store` 持久化
- [x] 2.3 API 配置管理（URL / Token / 默认模型）
- [x] 2.4 角色设定（system prompt）
- [x] 2.5 模型路由配置

## Phase 3：对话核心
- [x] 3.1 OpenAI 兼容 API 适配
- [x] 3.2 会话历史管理（创建/切换/删除/重命名/持久化）
- [x] 3.3 任务类型模型路由
- [x] 3.4 Tool Calling 流程
- [x] 3.5 工具注册与插件发现（基础版）

## Phase 4：工具系统
- [x] 4.1 `ITool` 接口规范
- [x] 4.2 文件读取工具（txt/doc/docx/xlsx/html/图片信息）
- [x] 4.3 文件写入工具（txt/html/xlsx）
- [x] 4.4 目录列举工具
- [x] 4.5 浏览器打开工具
- [x] 4.6 Live2D 控制工具（事件派发）
- [ ] 4.7 插件安全校验（签名/白名单/沙箱）

## Phase 5：桌面交互
- [x] 5.1 全局快捷键
- [x] 5.2 系统托盘
- [x] 5.3 悬浮聊天窗口
- [x] 5.4 文件夹监听（chokidar）
- [x] 5.5 多触发源提示词拼接

## Phase 6：Live2D
- [ ] 6.1 接入 `pixi-live2d-display` 实际渲染
- [ ] 6.2 支持 VTuber Studio 模型链路（`.model3.json` / `.moc3`）
- [x] 6.3 桌宠透明窗口
- [x] 6.4 点击交互触发会话
- [ ] 6.5 AI 驱动真实表情/动作映射表

## Phase 7：GUI 设置
- [x] 7.1 设置主页面
- [x] 7.2 API 配置页
- [x] 7.3 角色设定页
- [x] 7.4 路由配置页
- [x] 7.5 Live2D 设置页
- [x] 7.6 文件夹监听页
- [x] 7.7 快捷键页
- [x] 7.8 工具管理页

## Phase 8：打包与交付
- [x] 8.1 electron-builder 配置
- [x] 8.2 单文件 `portable exe` 打包脚本
- [x] 8.3 GitHub Actions autobuild（push main 自动构建 artifact）
- [x] 8.4 GitHub 标签发布（`v*` 自动上传 Release 资产）
- [ ] 8.5 应用内自动更新（非 CI，运行时升级）

---

## 当前重点剩余需求（按优先级）
1. 完成 Live2D 真实渲染链路（6.1 / 6.2 / 6.5）
2. 插件系统安全与稳定性增强（4.7）
3. 应用内自动更新（8.5）
4. 补齐端到端打包验证与回归测试
