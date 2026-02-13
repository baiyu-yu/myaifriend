import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { FileReadTool } from '../../src/main/tools/builtin/file-read'
import { FileListTool } from '../../src/main/tools/builtin/file-list'
import { FileInfoTool } from '../../src/main/tools/builtin/file-info'

async function createSandbox() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aibot-file-guard-'))
  const watch = path.join(root, 'watch')
  const outside = path.join(root, 'outside')
  await fs.mkdir(watch, { recursive: true })
  await fs.mkdir(outside, { recursive: true })
  await fs.writeFile(path.join(watch, 'inside.txt'), 'inside', 'utf-8')
  await fs.writeFile(path.join(outside, 'outside.txt'), 'outside', 'utf-8')
  return { root, watch, outside }
}

test('file_read blocks paths outside watch folder', async () => {
  const { root, watch, outside } = await createSandbox()
  const tool = new FileReadTool(() => ({ watchFolders: [watch] } as any))

  const blocked = await tool.execute({ path: path.join(outside, 'outside.txt') })
  assert.equal(blocked.isError, true)
  assert.match(blocked.content, /outside watch folders|not inside selected|escapes selected/i)

  const allowed = await tool.execute({ path: 'inside.txt' })
  assert.equal(allowed.isError, undefined)
  assert.equal(allowed.content, 'inside')

  await fs.rm(root, { recursive: true, force: true })
})

test('file_list blocks paths outside watch folder', async () => {
  const { root, watch, outside } = await createSandbox()
  const tool = new FileListTool(() => ({ watchFolders: [watch] } as any))

  const blocked = await tool.execute({ path: outside })
  assert.equal(blocked.isError, true)
  assert.match(blocked.content, /outside watch folders|not inside selected|escapes selected/i)

  const allowed = await tool.execute({ path: '.', recursive: false })
  assert.equal(allowed.isError, undefined)
  assert.match(allowed.content, /inside\.txt/)

  await fs.rm(root, { recursive: true, force: true })
})

test('file_info blocks paths outside watch folder', async () => {
  const { root, watch, outside } = await createSandbox()
  const tool = new FileInfoTool(() => ({ watchFolders: [watch] } as any))

  const blocked = await tool.execute({ path: path.join(outside, 'outside.txt') })
  assert.equal(blocked.isError, true)
  assert.match(blocked.content, /outside watch folders|not inside selected|escapes selected/i)

  const allowed = await tool.execute({ path: 'inside.txt' })
  assert.equal(allowed.isError, undefined)
  assert.match(allowed.content, /inside\.txt/)

  await fs.rm(root, { recursive: true, force: true })
})

