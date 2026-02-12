# 修复清单

- [x] live2d窗口除去模型和对话框以及功能按钮，其余部分整体窗口保持透明（参考"D:\dice\tool\aibot\model\live2d-kanban-desktop-master"）
- [x] live2d模型窗口被鼠标拖动一段时间后会变大，修复
- [x] live2d手动触发内置表情或动作功能按钮触发无法生效，日志如下`
2026-02-12 23:19:29
INFO
live2d
Live2D 手动触发表情: 裙子
2026-02-12 23:19:26
INFO
live2d
Live2D 手动触发表情: 爱心眼`

## 优化清单

- [x] 去除live2d冗余日志，优化日志系统，提供更多可靠日志以便后续调试和维护

### 功能添加

#### 每次修复后需要向github仓库推送，commit描述和标题除了feat/fix等前缀，均使用中文，且标题和描述不提到todo相关，直接描述做了什么修改

