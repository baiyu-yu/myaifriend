# AI Desktop Agent - 项目开发计划

## 技术栈
- 桌面框架：Electron
- 前端：Vue 3 + TypeScript + Vite
- UI：Element Plus
- 状态管理：Pinia
- Live2D：pixi-live2d-display（计划支持 VTuber Studio `.moc3`）
- 文件处理：mammoth（Word）、exceljs（Excel）、sharp（图片）
- 打包：electron-builder

---

## Phase 1: 项目基础架构搭建
- [x] 1.1 初始化项目结构（Electron + Vue3 + Vite + TypeScript）
- [x] 1.2 配置 Electron 主进程与渲染进程通信（IPC）
- [x] 1.3 配置开发环境热重载
- [x] 1.4 建立目录结构规范

## Phase 2: 核心配置系统
- [x] 2.1 统一配置文件格式设计（JSON 结构）
- [x] 2.2 配置持久化（electron-store）
- [x] 2.3 API 配置管理（URL/Token/模型）
- [x] 2.4 角色扮演设定管理（system prompt）
- [x] 2.5 多模型路由配置（按任务类型路由）

## Phase 3: AI 对话核心引擎
- [x] 3.1 通用 LLM API 适配层（OpenAI 兼容格式）
- [x] 3.2 对话历史管理（创建/切换/删除/持久化）
- [x] 3.3 多模型路由器（根据任务类型选择模型）
- [x] 3.4 Tool Calling 框架（function calling）
- [x] 3.5 工具注册/发现机制（插件式自动发现，基础版）

## Phase 4: 工具系统实现
- [x] 4.1 工具接口规范（`ITool` interface）
- [x] 4.2 文件读写工具（txt/word/excel/html/图片）
- [x] 4.3 浏览器打开工具（打开 HTML/URL）
- [x] 4.4 Live2D 控制工具（表情/动作）
- [x] 4.5 预留工具扩展接口（插件目录 + 动态加载，基础版）

## Phase 5: 桌面交互系统
- [x] 5.1 全局快捷键（唤起/隐藏对话窗口）
- [x] 5.2 系统托盘图标
- [x] 5.3 对话悬浮窗（透明置顶窗口）
- [x] 5.4 文件夹监听（chokidar）
- [x] 5.5 多种唤起方式及对应提示词拼接

## Phase 6: Live2D 虚拟形象系统
- [ ] 6.1 集成 pixi-live2d-display 渲染引擎
- [ ] 6.2 支持 VTuber Studio 格式模型加载（`.moc3`）
- [x] 6.3 桌宠窗口（透明无边框置顶）
- [x] 6.4 模型交互（点击触发对话）
- [ ] 6.5 AI 驱动表情/动作控制（与真实模型联动）
- [x] 6.6 快捷键隐藏/显示

## Phase 7: GUI 设置界面
- [x] 7.1 设置主界面布局
- [x] 7.2 API 配置页面（URL/Token/模型）
- [x] 7.3 角色设定页面（system prompt 编辑）
- [x] 7.4 模型路由配置页面
- [x] 7.5 Live2D 模型管理页面
- [x] 7.6 文件夹路径配置页面
- [x] 7.7 快捷键配置页面
- [x] 7.8 工具管理页面

## Phase 8: 打包与发布
- [x] 8.1 配置 electron-builder
- [x] 8.2 Windows 安装包打包配置
- [ ] 8.3 自动更新配置

---

## 下一步优先级
1. 实现插件化工具发现（Phase 3.5 / 4.5）
2. 接入真实 Live2D 渲染与模型加载（Phase 6.1 / 6.2 / 6.5）
3. 增加自动更新能力（Phase 8.3）
