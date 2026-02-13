# 修复清单
- [x] live2d手动触发内置表情或动作功能按钮触发无法生效，日志如下`
2026-02-13 00:01:34
WARN
live2d
Live2D 手动触发表情失败: 戴帽子, mapped=戴帽子
2026-02-13 00:01:34
WARN
live2d
Live2D 动作执行失败: type=expression, input=戴帽子, mapped=戴帽子, available=无, errors=戴帽子: expression(name) 返回 false，且未匹配到表达式索引 | Error: expression(name) 返回 false，且未匹配到表达式索引 > at executeByName (http://localhost:5173/src/views/Live2DView.vue:518:19)
2026-02-13 00:01:34
WARN
live2d
Live2D 动作可用列表为空: type=expression, input=戴帽子, mapped=戴帽子, modelDefs(expression=0,motionGroup=0)
2026-02-13 00:01:34
INFO
live2d
Live2D 手动触发表情请求: input=戴帽子, mapped=戴帽子, available=0, sample=无
2026-02-13 00:01:18
WARN
live2d
Live2D 手动触发表情失败: jk包, mapped=jk包
2026-02-13 00:01:18
WARN
live2d
Live2D 动作执行失败: type=expression, input=jk包, mapped=jk包, available=无, errors=jk包: expression(name) 返回 false，且未匹配到表达式索引 | Error: expression(name) 返回 false，且未匹配到表达式索引 > at executeByName (http://localhost:5173/src/views/Live2DView.vue:518:19)
2026-02-13 00:01:18
WARN
live2d
Live2D 动作可用列表为空: type=expression, input=jk包, mapped=jk包, modelDefs(expression=0,motionGroup=0)`需要更多关于该问题的日志以便后续调试和修复

## 优化清单


### 功能添加
- [x] live2d窗口的功能按钮也需要可以隐藏和移动

#### 每次修复后需要向github仓库推送，commit描述和标题除了feat/fix等前缀，均使用中文，且标题和描述不提到todo相关，直接描述做了什么修改
