# 本地 Mock 后端（省钱测试）

## 作用
- 提供一个独立本地接口，兼容 `/chat/completions`。
- 用于替代真实付费模型，做功能联调和工具链测试。

## 启动
```bash
npm run mock:api
```

默认地址：
- `http://127.0.0.1:8787/v1/chat/completions`

## 在应用里如何配置
在设置里新增一个 API：
- `name`: `mock-local`
- `baseUrl`: `http://127.0.0.1:8787/v1`
- `apiKey`: `mock`
- `defaultModel`: `mock-gemini-2.5-flash`

然后把 `premier` / `tool_calling` / `code_generation`（以及你想测试的其他任务）切到这个 API。

## 支持的行为
- 规划阶段：返回 workflow JSON。
- 工具阶段：返回 `tool_calls`（会按指令匹配 `live2d_control` / `file_write` / `open_in_browser` 等）。
- 工具回填阶段：根据 tool message 生成总结。
- 视觉阶段：若请求里带 `image_url`，返回固定 mock 视觉文本。

## 可选环境变量
- `MOCK_API_HOST`：监听地址（默认 `127.0.0.1`）
- `MOCK_API_PORT`：监听端口（默认 `8787`）
- `MOCK_API_MODEL`：返回的模型名（默认 `mock-gemini-2.5-flash`）
- `MOCK_EMPTY_TOOL_CALL_RATE`：模拟模型空工具响应概率（`0` 到 `1`，默认 `0`）

示例：
```bash
MOCK_EMPTY_TOOL_CALL_RATE=0.2 npm run mock:api
```

