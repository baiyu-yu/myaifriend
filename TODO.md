# 修复清单

- [x] file_write工具需要将文件写入到监听的文件夹中，现阶段不知道写入到哪去了
- [x] 工作流逻辑有误区，我的需求如下，帮我整理并完成：
{
# AI 自动化工作流系统架构规范

## 1. 系统综述
本系统采用**中心化编排-分布式执行（Hub-and-Spoke with Dependency Management）**架构。核心由“总理模型（Orchestrator）”进行全局规划与调度，各垂类模型（Worker Models）负责具体执行。系统支持上下文动态隔离、任务依赖管理及长短期记忆调用。

## 2. 核心角色定义

* **总理模型（Orchestrator / Prime Minister）**：
    * **职责**：意图识别、工作流规划、任务分拆、依赖关系定义、最终结果合成。
    * **权限**：访问完整上下文、记忆系统（向量数据库）、文件系统、所有可用工具列表。
* **执行单元（Workers）**：
    * **角色扮演模型（RP Agent）**：负责情感化、人设化的文本生成。
    * **代码编写模型（Coder Agent）**：负责生成代码，不处理闲聊。
    * **工具调用模型（Tool Agent）**：负责将自然语言转化为结构化 API/工具调用指令。

## 3. 工作流详述

### 第一阶段：触发与规划 (Initialization & Planning)
1.  **触发输入**：
    * 触发源（用户指令/系统事件）。
    * 系统状态：可用工具列表、工具说明。
    * 上下文数据：
        * **全局上下文**：当前对话历史。
        * **潜意识记忆**：通过向量匹配检索到的长期记忆片段。
        * **环境信息**：可操作的文件列表、项目结构。
2.  **总理模型处理**：
    * 分析上述输入。
    * **输出结构化工作流计划**（JSON/YAML格式），包含：
        * `workflow_id`：任务流ID。
        * `tasks`：任务列表。每个任务包含 `task_id`, `model_type` (RP/Coder/Tool), `input_prompt` (精炼后的指令), `dependencies` (依赖的前序 task_id)。
        * `final_intent`：最终回复的指导意图。

### 第二阶段：调度与执行 (Dispatch & Execution)
系统根据总理模型生成的计划进行调度：
1.  **依赖分析**：构建任务有向无环图 (DAG)。若任务 A 依赖任务 B，则挂起 A，直至 B 完成。无依赖任务并发执行。
2.  **上下文隔离构建 (Prompt Construction)**：
    * **角色扮演任务**：仅输入总理模型提取的“回复意图”及必要的人设信息（不包含无关技术细节）。
    * **代码编写任务**：仅输入总理模型描述的“功能需求文档”（不包含情绪化文本）。此时输出为代码文本。
    * **工具调用任务**：输入总理模型的“操作指令”，模型输出结构化调用参数。
3.  **执行与反馈**：
    * 工具/代码执行层实际运行代码或 API。
    * **文件操作**：若代码模型生成代码，系统自动写入文件，并将生成的`file_path`作为结果返回。
    * **结果回传**：每个 Task 完成后，其输出（Output/Result）被标记为 `completed`，并作为上下文注入到依赖它的后续 Task 中。

### 第三阶段：合成与响应 (Synthesis & Response)
1.  **结果汇聚**：当所有子任务执行完毕，收集所有 `Task Outputs`（包括工具返回结果、生成的代码路径、RP生成的草稿等）。
2.  **最终回复生成**：
    * 再次唤起**总理模型**。
    * **输入**：原始用户指令 + 完整的任务执行结果日志。
    * **指令**：根据工具执行结果（如代码是否运行成功、API 返回的数据）和最初的回复意向，生成最终面向用户的回复。
3.  **输出**：将最终回复发送给用户。

## 4. 数据流转示例 (伪代码,非实际使用中的代码)

```json
{
  "plan": {
    "task_A": {
      "role": "Coder",
      "instruction": "编写一个Python脚本计算斐波那契数列",
      "dependency": [] 
    },
    "task_B": {
      "role": "Tool_Exec",
      "instruction": "执行task_A生成的脚本",
      "dependency": ["task_A"]
    },
    "task_C": {
      "role": "RolePlay",
      "instruction": "根据task_B的运行结果，用傲娇的语气向用户汇报",
      "dependency": ["task_B"]
    }
  }
}

```

## 5. 关键约束

1. **最小权限原则**：子模型只接收完成任务所需的最小上下文，避免Prompt污染。
2. **异步阻塞**：依赖链必须严格遵守，未满足依赖的任务不得启动。
3. **总理模型全知**：只有总理模型拥有上帝视角，子模型均为专才。
}

下述为调用日志，无法判断没有任何一个调用成功的原因。我的命令是让ai收起live2d形象右边马尾，然后举起手柄，同时生成一个html文件并为我打开
`026-02-13 20:15:28
INFO
chat-workflow
[workflow] final_synthesis | workflow_id=wf_live2d_html_001 | model=gemini-3-pro-preview-low | task_count=4
2026-02-13 20:15:28
INFO
chat-workflow
[workflow] task_done | workflow_id=wf_live2d_html_001 | task_id=open_generated_html | output_length=0 | tool_calls=0 | tool_errors=0
2026-02-13 20:14:50
INFO
chat-workflow
[workflow] task_done | workflow_id=wf_live2d_html_001 | task_id=live2d_hold_controller | output_length=174 | tool_calls=0 | tool_errors=0
2026-02-13 20:14:44
INFO
chat-workflow
[workflow] task_start | workflow_id=wf_live2d_html_001 | task_id=open_generated_html | model_type=tool | route_task_type=premier | model=gemini-3-pro-preview-low | deps=generate_html_file | use_tools=true
2026-02-13 20:14:44
INFO
chat-workflow
[workflow] task_start | workflow_id=wf_live2d_html_001 | task_id=live2d_hold_controller | model_type=tool | route_task_type=premier | model=gemini-3-pro-preview-low | deps=live2d_hide_ponytail | use_tools=true
2026-02-13 20:14:44
INFO
chat-workflow
[workflow] task_done | workflow_id=wf_live2d_html_001 | task_id=live2d_hide_ponytail | output_length=52 | tool_calls=0 | tool_errors=0
2026-02-13 20:14:26
INFO
chat-workflow
[workflow] task_done | workflow_id=wf_live2d_html_001 | task_id=generate_html_file | output_length=802 | tool_calls=0 | tool_errors=0
2026-02-13 20:13:24
INFO
chat-workflow
[workflow] task_start | workflow_id=wf_live2d_html_001 | task_id=generate_html_file | model_type=tool | route_task_type=premier | model=gemini-3-pro-preview-low | deps=none | use_tools=true
2026-02-13 20:13:24
INFO
chat-workflow
[workflow] task_start | workflow_id=wf_live2d_html_001 | task_id=live2d_hide_ponytail | model_type=tool | route_task_type=premier | model=gemini-3-pro-preview-low | deps=none | use_tools=true
2026-02-13 20:13:24
INFO
chat-workflow
[workflow] plan_created | workflow_id=wf_live2d_html_001 | task_count=4 | task_ids=live2d_hide_ponytail,live2d_hold_controller,generate_html_file,open_generated_html
2026-02-13 20:12:13
INFO
chat-workflow
[workflow] chat_start | trigger=text_input | incoming_messages=3 | prepared_messages=3 | tool_count=10`

## 优化清单

- [x] 优化触发ai对话的日志打印
- [x] 将live2d窗口的输出框调整为只在两行内，与输入框相连，在输入框下方，并且增加滚动条以适应内容过多的情况，且除了有新回复覆盖掉内部内容，不会消失

### 功能添加

- [x] 工具调用模型的配置项
- [x] 自定义请求体采用更易书写的键值对格式，且支持嵌套结构

#### 每次修复后需要向github仓库推送，commit描述和标题除了feat/fix等前缀，均使用中文，且标题和描述不提到todo相关，直接描述做了什么修改
