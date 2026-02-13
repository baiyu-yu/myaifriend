# 修复清单
- [x] live2d窗口浮动到所有窗口上方不够稳定，偶尔会被其他窗口覆盖
- [x] live2d手动触发内置表情或动作功能按钮触发无法生效，日志如下`
2026-02-13 16:01:34
INFO
trigger-ipc
AI 触发请求: click_avatar
2026-02-13 16:01:32
WARN
live2d
Live2D 手动触发表情失败: 圈圈眼, mapped=圈圈眼
2026-02-13 16:01:32
WARN
live2d
Live2D 动作执行失败: type=expression, input=圈圈眼, mapped=圈圈眼, candidates=圈圈眼, available=无, mapSample=jk包->jk包, 圈圈眼->圈圈眼, 戴帽子->戴帽子, 手柄->手柄, 爱心眼->爱心眼, 脱外套->脱外套, errors=圈圈眼: expression(name) 返回 false，且未匹配到表达式索引 | Error: expression(name) 返回 false，且未匹配到表达式索引 > at executeByName (http://localhost:5173/src/views/Live2DView.vue:616:19)
2026-02-13 16:01:32
WARN
live2d
Live2D 动作可用列表为空: type=expression, input=圈圈眼, mapped=圈圈眼, modelDefs(expression=0,motionGroup=0,expMgr=false), expSample=无, motSample=无
2026-02-13 16:01:32
INFO
live2d
Live2D 手动触发表情请求: input=圈圈眼, mapped=圈圈眼, options=10, available=0, sample=无, mapSample=jk包->jk包, 圈圈眼->圈圈眼, 戴帽子->戴帽子, 手柄->手柄, 爱心眼->爱心眼, 脱外套->脱外套
2026-02-13 16:01:29
WARN
live2d
Live2D 手动触发表情失败: jk包, mapped=jk包
2026-02-13 16:01:29
WARN
live2d
Live2D 动作执行失败: type=expression, input=jk包, mapped=jk包, candidates=jk包, available=无, mapSample=jk包->jk包, 圈圈眼->圈圈眼, 戴帽子->戴帽子, 手柄->手柄, 爱心眼->爱心眼, 脱外套->脱外套, errors=jk包: expression(name) 返回 false，且未匹配到表达式索引 | Error: expression(name) 返回 false，且未匹配到表达式索引 > at executeByName (http://localhost:5173/src/views/Live2DView.vue:616:19)
2026-02-13 16:01:29
WARN
live2d
Live2D 动作可用列表为空: type=expression, input=jk包, mapped=jk包, modelDefs(expression=0,motionGroup=0,expMgr=false), expSample=无, motSample=无
2026-02-13 16:01:29
INFO
live2d
Live2D 手动触发表情请求: input=jk包, mapped=jk包, options=10, available=0, sample=无, mapSample=jk包->jk包, 圈圈眼->圈圈眼, 戴帽子->戴帽子, 手柄->手柄, 爱心眼->爱心眼, 脱外套->脱外套`源文件在model文件夹下。需要更多关于该问题的日志以便后续调试和修复


## 优化清单


### 功能添加
- [x] live2d窗口的功能按钮需要可以通过快捷键隐藏，且拖动不需要写一个拖动两个字上去

#### 每次修复后需要向github仓库推送，commit描述和标题除了feat/fix等前缀，均使用中文，且标题和描述不提到todo相关，直接描述做了什么修改
