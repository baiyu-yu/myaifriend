# 修复清单

- [x] live2d模型窗口无法正确显示live2d模型，参考"D:\dice\tool\aibot\model\live2d-kanban-desktop-master"对于相关功能的实现，对此处进行修复
- [x] 文件夹文件变动没有正确监控并触发ai。且优化文件变动逻辑，如果短时间内某个文件一直在变动，则等待到其不发生变动后再触发ai（规避编辑实时保存的情况）
- [x] ai触发需要相关日志，添加更多的日志打印
- [x] 对话框对话触发报错：`发生错误: An object could not be cloned.`

## 优化清单


### 每次修复后需要向github仓库推送，commit描述和标题除了feat/fix等前缀，均使用中文，且标题和描述不提到todo相关，直接描述做了什么修改
