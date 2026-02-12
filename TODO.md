# 修复清单

- [x] live2d模型窗口无法正确显示live2d模型，live2d模型读取后需要自动读取并初步配置表情和动作等可操控功能，显示到映射列表中（如Live2D 映射已自动读取: expression 0 项, motion 14 项，此时动作映射表应当显示所有读取到的项，自动刷新而非读取旧配置）。请根据model文件夹下的两种模型文件格式实现相关读取（不需要把他们打包进程序，只是一个示例）。
`
026-02-12 20:30:59
INFO
live2d
Live2D 映射已自动读取并切换: D:\dice\tool\chaos\ariu\ariu.model3.json | expression 10 项, motion 0 项
2026-02-12 20:30:59
INFO
live2d
Live2D 映射解析详情: model(exp:0,motion:0) companion(exp:10,motion:0) scan(exp:0,motion:0) | exp示例: jk包, 圈圈眼, 戴帽子, 手柄, 爱心眼 | motion示例: 无
2026-02-12 20:30:45
INFO
live2d
Live2D 映射已自动读取并切换: D:\dice\tool\chaos\hiyori_free_en\runtime\hiyori_free_t08.model3.json | expression 0 项, motion 14 项
2026-02-12 20:30:45
INFO
live2d
Live2D 映射解析详情: model(exp:0,motion:14) companion(exp:0,motion:0) scan(exp:0,motion:0) | exp示例: 无 | motion示例: Idle, hiyori_m01, hiyori_m02, hiyori_m05, Flick`
上述日志分别未对model文件夹下两个模型文件文件夹的读取结果，读取了应当显示在下方的`动作/表情映射（别名 => 实际名称）`表格中，现在实际并没有显示；
- [x] 可读取并保存多个live2d模型，去掉无用的热切换按钮。已读取过的修改过的映射列表与读取的模型文件夹做对应保存；
- [x] 若存在读取问题请提供相应报错，目前日志太少，无法确定live2d模型读取存在何种问题

## 优化清单

- [x] 优化设置中心的选项单的收起按钮，需要合理美观的轮廓；

### 每次修复后需要向github仓库推送，commit描述和标题除了feat/fix等前缀，均使用中文，且标题和描述不提到todo相关，直接描述做了什么修改
