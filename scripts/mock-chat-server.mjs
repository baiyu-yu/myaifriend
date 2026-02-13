import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { URL } from 'node:url'

const HOST = process.env.MOCK_API_HOST || '127.0.0.1'
const PORT = Number(process.env.MOCK_API_PORT || 8787)
const DEFAULT_MODEL = process.env.MOCK_API_MODEL || 'mock-gemini-2.5-flash'
const EMPTY_TOOL_CALL_RATE = Math.max(0, Math.min(1, Number(process.env.MOCK_EMPTY_TOOL_CALL_RATE || 0)))

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

function toText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return ''
      if (typeof item.text === 'string') return item.text
      if (typeof item.type === 'string' && item.type === 'text' && typeof item.text === 'string') return item.text
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function getMessages(body) {
  return Array.isArray(body?.messages) ? body.messages : []
}

function latestTextByRole(messages, role) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === role) return toText(messages[i]?.content)
  }
  return ''
}

function extractPathFromText(text) {
  const source = String(text || '')
  const absolute = source.match(/[a-zA-Z]:[\\/][^\s"'`]+?\.(html?|txt|json|png|jpe?g|webp|gif|bmp)/i)
  if (absolute?.[0]) return absolute[0]
  const relative = source.match(/[\w./\\-]+?\.(html?|txt|json|png|jpe?g|webp|gif|bmp)/i)
  if (relative?.[0]) return relative[0].replace(/\\/g, '/')
  return ''
}

function extractHtmlFromText(text) {
  const source = String(text || '')
  const fenced = source.match(/```html\s*([\s\S]*?)```/i)
  if (fenced?.[1]?.trim()) return fenced[1].trim()
  if (/<!doctype html/i.test(source) || /<html[\s>]/i.test(source)) return source.trim()
  return ''
}

function createChatCompletion({
  model,
  message,
  finishReason = 'stop',
}) {
  return {
    id: `req_${Date.now()}_${randomUUID().slice(0, 8)}`,
    object: 'chat.completion',
    created: nowSeconds(),
    model: model || DEFAULT_MODEL,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  }
}

function hasVisionInput(messages) {
  return messages.some((msg) => {
    if (!Array.isArray(msg?.content)) return false
    return msg.content.some((item) => item?.type === 'image_url')
  })
}

function makeWorkflowPlan(latestUserText) {
  const text = String(latestUserText || '')
  const normalized = text.toLowerCase()
  const hasPonytail = /马尾r隐藏|右边马尾|right ponytail/.test(text)
  const hasController = /手柄|controller|gamepad/.test(text)
  const hasHtml = /html/.test(normalized)

  const tasks = []
  if (hasPonytail) {
    tasks.push({
      task_id: 'task_hide_right_ponytail',
      model_type: 'tool',
      input_prompt: '收起live2d形象右边马尾',
      dependencies: [],
      use_tools: true,
    })
  }
  if (hasController) {
    tasks.push({
      task_id: 'task_raise_controller',
      model_type: 'tool',
      input_prompt: '举起手柄',
      dependencies: hasPonytail ? ['task_hide_right_ponytail'] : [],
      use_tools: true,
    })
  }
  if (hasHtml) {
    tasks.push({
      task_id: 'task_generate_html',
      model_type: 'coder',
      input_prompt: 'Generate a simple HTML page indicating the mock flow completed.',
      dependencies: [],
      use_tools: false,
    })
    tasks.push({
      task_id: 'task_write_html',
      model_type: 'tool',
      input_prompt: "Write the provided HTML content into 'test/generated_view.html'.",
      dependencies: ['task_generate_html'],
      use_tools: true,
    })
    tasks.push({
      task_id: 'task_open_html',
      model_type: 'tool',
      input_prompt: "Open the file 'test/generated_view.html' in browser.",
      dependencies: ['task_write_html'],
      use_tools: true,
    })
  }

  if (!tasks.length) {
    tasks.push({
      task_id: 'task_1',
      model_type: 'tool',
      input_prompt: text || 'Respond to user request',
      dependencies: [],
      use_tools: true,
    })
  }

  return {
    workflow_id: `wf_mock_${Date.now()}`,
    tasks,
    final_intent: 'Summarize execution status based on tool results.',
  }
}

function makeToolCallResponse(body, messages) {
  const tools = Array.isArray(body?.tools) ? body.tools : []
  const toolNames = tools.map((item) => item?.function?.name).filter(Boolean)
  const latestUserText = latestTextByRole(messages, 'user')
  const merged = String(latestUserText || '')
  const normalized = merged.toLowerCase()

  if (EMPTY_TOOL_CALL_RATE > 0 && Math.random() < EMPTY_TOOL_CALL_RATE) {
    return createChatCompletion({
      model: body?.model,
      message: { role: 'assistant', content: '' },
      finishReason: null,
    })
  }

  const call = { name: '', args: {} }

  if (toolNames.includes('live2d_control') && /马尾l隐藏|左边马尾|left ponytail/.test(merged)) {
    call.name = 'live2d_control'
    call.args = { action_type: 'expression', action_name: '马尾L隐藏' }
  } else if (toolNames.includes('live2d_control') && /马尾r隐藏|右边马尾|右马尾|马尾|right ponytail|ponytail/.test(merged)) {
    call.name = 'live2d_control'
    call.args = { action_type: 'expression', action_name: '马尾R隐藏' }
  } else if (toolNames.includes('live2d_control') && /手柄|controller|gamepad/.test(merged)) {
    call.name = 'live2d_control'
    call.args = { action_type: 'expression', action_name: '手柄' }
  } else if (toolNames.includes('file_write') && /html/.test(normalized) && /(write|create|save|生成|写入)/.test(normalized)) {
    const htmlPath = extractPathFromText(merged) || 'test/generated_view.html'
    const htmlContent =
      extractHtmlFromText(merged) ||
      '<!doctype html><html><head><meta charset="utf-8"><title>Mock</title></head><body><h1>Mock OK</h1><p>This is generated by local mock backend.</p></body></html>'
    call.name = 'file_write'
    call.args = { path: htmlPath, content: htmlContent }
  } else if (toolNames.includes('open_in_browser') && /html/.test(normalized) && /(open|打开)/.test(normalized)) {
    call.name = 'open_in_browser'
    call.args = { path: extractPathFromText(merged) || 'test/generated_view.html' }
  } else if (toolNames.includes('web_search')) {
    call.name = 'web_search'
    call.args = { query: merged || 'mock query' }
  } else if (toolNames.includes('file_read')) {
    call.name = 'file_read'
    call.args = { path: extractPathFromText(merged) || 'test/2.txt' }
  } else if (toolNames.includes('file_list')) {
    call.name = 'file_list'
    call.args = { path: '.', recursive: false }
  } else if (toolNames.includes('file_info')) {
    call.name = 'file_info'
    call.args = { path: extractPathFromText(merged) || 'test/2.txt' }
  } else if (toolNames.includes('vision_analyze')) {
    call.name = 'vision_analyze'
    call.args = { image_path: extractPathFromText(merged) || 'test/sample.png' }
  } else if (toolNames.includes('memory_search')) {
    call.name = 'memory_search'
    call.args = { query: merged || 'mock memory query' }
  } else if (toolNames.includes('conversation_search')) {
    call.name = 'conversation_search'
    call.args = { query: merged || 'mock conversation query' }
  }

  if (!call.name && toolNames.length > 0) {
    call.name = toolNames[0]
    call.args = {}
  }

  if (!call.name) {
    return createChatCompletion({
      model: body?.model,
      message: { role: 'assistant', content: 'No tools available in request.' },
      finishReason: 'stop',
    })
  }

  return createChatCompletion({
    model: body?.model,
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: `call_${randomUUID().slice(0, 10)}`,
          type: 'function',
          function: {
            name: call.name,
            arguments: JSON.stringify(call.args),
          },
        },
      ],
    },
    finishReason: 'tool_calls',
  })
}

function makeNoToolResponse(body, messages) {
  const latestUserText = latestTextByRole(messages, 'user')
  const systemText = messages
    .filter((item) => item?.role === 'system')
    .map((item) => toText(item?.content))
    .join('\n')

  if (/orchestrator model for a dependency-based workflow system/i.test(systemText)) {
    const plan = makeWorkflowPlan(latestUserText)
    return createChatCompletion({
      model: body?.model,
      message: { role: 'assistant', content: JSON.stringify(plan, null, 2) },
      finishReason: 'stop',
    })
  }

  if (/orchestrator final synthesis stage/i.test(systemText)) {
    const hasError = /(error|failed|outside watch|not configured|isError)/i.test(latestUserText)
    const content = hasError ? '模拟后端汇总：任务部分失败，请查看工具错误日志。' : '模拟后端汇总：任务执行完成。'
    return createChatCompletion({
      model: body?.model,
      message: { role: 'assistant', content },
      finishReason: 'stop',
    })
  }

  if (/You are the Coder worker/i.test(systemText)) {
    const content =
      '```html\n<!doctype html>\n<html>\n  <head>\n    <meta charset="utf-8" />\n    <title>Mock Generated</title>\n  </head>\n  <body>\n    <h1>Hello!</h1>\n    <p>This HTML is generated by local mock backend.</p>\n  </body>\n</html>\n```'
    return createChatCompletion({
      model: body?.model,
      message: { role: 'assistant', content },
      finishReason: 'stop',
    })
  }

  if (hasVisionInput(messages)) {
    return createChatCompletion({
      model: body?.model,
      message: {
        role: 'assistant',
        content: 'Mock vision result: image received and analyzed locally in mock mode.',
      },
      finishReason: 'stop',
    })
  }

  return createChatCompletion({
    model: body?.model,
    message: { role: 'assistant', content: `Mock response: ${latestUserText || 'ok'}` },
    finishReason: 'stop',
  })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function isChatCompletionPath(pathname) {
  return /\/chat\/completions$/i.test(pathname.replace(/\/+$/, ''))
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname

  if (req.method === 'GET' && pathname === '/health') {
    return sendJson(res, 200, { ok: true, mode: 'mock', model: DEFAULT_MODEL })
  }

  if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
    return sendJson(res, 200, {
      object: 'list',
      data: [
        { id: DEFAULT_MODEL, object: 'model', created: nowSeconds(), owned_by: 'mock' },
        { id: 'mock-gemini-3-pro-preview-low', object: 'model', created: nowSeconds(), owned_by: 'mock' },
      ],
    })
  }

  if (req.method === 'POST' && isChatCompletionPath(pathname)) {
    try {
      const body = await readBody(req)
      const messages = getMessages(body)
      const hasTools = Array.isArray(body?.tools) && body.tools.length > 0
      const hasToolMessages = messages.some((item) => item?.role === 'tool')

      let payload
      if (hasTools && !hasToolMessages) {
        payload = makeToolCallResponse(body, messages)
      } else if (hasToolMessages) {
        const toolText = messages
          .filter((item) => item?.role === 'tool')
          .map((item) => toText(item?.content))
          .filter(Boolean)
          .join('\n')
        payload = createChatCompletion({
          model: body?.model,
          message: { role: 'assistant', content: toolText ? `Mock tool handled:\n${toolText}` : 'Mock tool handled.' },
          finishReason: 'stop',
        })
      } else {
        payload = makeNoToolResponse(body, messages)
      }

      return sendJson(res, 200, payload)
    } catch (error) {
      return sendJson(res, 400, {
        error: 'invalid_request',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return sendJson(res, 404, { error: 'not_found', path: pathname })
})

server.listen(PORT, HOST, () => {
  console.log(`[mock-api] listening on http://${HOST}:${PORT}`)
  console.log(`[mock-api] chat endpoint: http://${HOST}:${PORT}/v1/chat/completions`)
  console.log(`[mock-api] env: MOCK_EMPTY_TOOL_CALL_RATE=${EMPTY_TOOL_CALL_RATE}`)
})
