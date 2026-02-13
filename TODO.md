# 修复清单

- [x] 设置中心api与模型配置部分点击保存配置没有相应提示，且点击后仍然无法触发ai对话，报错`[1] Error occurred in handler for 'chat:send': Error: 未配置可用 API，请先在设置页添加 API 配置。
[1]     at AIEngine.chat (D:\dice\tool\aibot\dist\main\main\ai\ai-engine.js:80:23)
[1]     at async D:\dice\tool\aibot\dist\main\main\index.js:1014:35
[1]     at async Session.<anonymous> (node:electron/js2c/browser_init:2:116443)`


## 优化清单

- [x] live2d窗口的功能按钮需要可以通过快捷键隐藏，记得在设置中心添加
- [x] 设置中心唤起提示词窗口中快捷键唤起配置删除
- [x] 切换live2d模型保持之前设置，包括模型位置大小等


### 功能添加


#### 每次修复后需要向github仓库推送，commit描述和标题除了feat/fix等前缀，均使用中文，且标题和描述不提到todo相关，直接描述做了什么修改
