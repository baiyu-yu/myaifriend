# 修复清单

- [x] live2d窗口除去模型和对话框以及功能按钮，其余部分整体窗口保持透明，现在鼠标点击等能透过但是无法看到窗口后内容，需要调整为鼠标点击等能透过且能看到窗口后内容
- [x] live2d手动触发内置表情或动作功能按钮触发无法生效，日志如下`
2026-02-12 23:52:53
INFO
live2d
Live2D 模型缩放: scale=0.131, deltaY=100.0
2026-02-12 23:52:52
INFO
live2d
Live2D 模型缩放: scale=0.113, deltaY=-100.0
2026-02-12 23:52:47
INFO
live2d
Live2D 模型缩放: scale=0.113, deltaY=100.0
2026-02-12 23:52:45
INFO
live2d
Live2D 窗口已固定全屏: reason=toggle-show, size=1280x800
2026-02-12 23:52:38
INFO
live2d
Live2D 窗口已固定全屏: reason=toggle-show, size=1280x800
2026-02-12 23:52:17
INFO
live2d
Live2D 手动触发表情成功: 圈圈眼 => 圈圈眼
2026-02-12 23:52:17
INFO
live2d
Live2D 手动触发表情请求: input=圈圈眼, mapped=圈圈眼, available=0, sample=无
2026-02-12 23:52:14
INFO
live2d
Live2D 手动触发表情成功: jk包 => jk包
2026-02-12 23:52:14
INFO
live2d
Live2D 手动触发表情请求: input=jk包, mapped=jk包, available=0, sample=无
2026-02-12 23:52:09
INFO
live2d
Live2D 窗口已固定全屏: reason=toggle-show, size=1280x800
2026-02-12 23:52:06
INFO
live2d
Live2D 模型布局完成: reason=retry-900ms, stage=1280x800, model=2846.0x5482.0, scale=0.131, pos=(640.0,794.0)
2026-02-12 23:52:05
INFO
live2d
Live2D 模型加载成功: D:\dice\tool\chaos\ariu\ariu.model3.json | texture=14, motionGroup=0, expression=0
2026-02-12 23:52:05
INFO
live2d
Live2D 模型布局完成: reason=initial, stage=1280x800, model=2846.0x5482.0, scale=0.131, pos=(640.0,794.0)
2026-02-12 23:52:05
INFO
live2d
Live2D 模型已从主路径加载: file:///D:/dice/tool/chaos/ariu/ariu.model3.json
2026-02-12 23:52:05
INFO
live2d
Live2D 模型候选路径: file:///D:/dice/tool/chaos/ariu/ariu.model3.json
2026-02-12 23:52:05
INFO
live2d
Live2D 模型加载请求: D:\dice\tool\chaos\ariu\ariu.model3.json
2026-02-12 23:52:05
INFO
live2d
Live2D cubism4 模块已加载: NORMAL=2, FORCE=3
2026-02-12 23:52:05
INFO
live2d
Live2D Cubism Core 已就绪
2026-02-12 23:52:05
INFO
live2d
Live2D 运行时准备开始: cubismCore=/@fs/D:/dice/tool/aibot/node_modules/live2dcubismcore/live2dcubismcore.min.js
2026-02-12 23:52:05
INFO
live2d
Live2D 行为参数已更新: source=initial-config, sway=false, amp=8, speed=0.8, eye=true
2026-02-12 23:52:05
WARN
live2d
Live2D interaction manager 已做兼容补丁: reason=after-pixi-init, before(on=false,off=false), after(on=false,off=true)
2026-02-12 23:52:04
INFO
live2d
Live2D 页面挂载
2026-02-12 23:52:04
INFO
live2d
Live2D 窗口初始化下发模型: D:\dice\tool\chaos\ariu\ariu.model3.json
2026-02-12 23:52:04
INFO
live2d
Live2D 窗口完成加载: hasModel=true visible=false`需要更多关于该问题的日志以便后续调试和修复

## 优化清单


### 功能添加


#### 每次修复后需要向github仓库推送，commit描述和标题除了feat/fix等前缀，均使用中文，且标题和描述不提到todo相关，直接描述做了什么修改
