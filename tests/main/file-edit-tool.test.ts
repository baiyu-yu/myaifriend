import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { FileEditTool } from '../../src/main/tools/builtin/file-edit'

async function setupFile() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aibot-file-edit-'))
  const watch = path.join(root, 'watch')
  await fs.mkdir(watch, { recursive: true })
  const filePath = path.join(watch, 'sample.txt')
  await fs.writeFile(filePath, 'hello world', 'utf-8')
  return { root, watch, filePath }
}

test('file_edit supports insert and delete_range', async () => {
  const { root, watch, filePath } = await setupFile()
  const tool = new FileEditTool(() => ({ watchFolders: [watch] } as any))

  const insert = await tool.execute({ path: 'sample.txt', mode: 'insert', index: 5, content: '-' })
  assert.equal(insert.isError, undefined)

  const del = await tool.execute({ path: 'sample.txt', mode: 'delete_range', start: 5, end: 6 })
  assert.equal(del.isError, undefined)

  const content = await fs.readFile(filePath, 'utf-8')
  assert.equal(content, 'hello world')

  await fs.rm(root, { recursive: true, force: true })
})

test('file_edit supports regex_replace and regex_delete', async () => {
  const { root, watch, filePath } = await setupFile()
  const tool = new FileEditTool(() => ({ watchFolders: [watch] } as any))

  const replace = await tool.execute({ path: 'sample.txt', mode: 'regex_replace', pattern: 'world', content: 'tool' })
  assert.equal(replace.isError, undefined)

  const del = await tool.execute({ path: 'sample.txt', mode: 'regex_delete', pattern: 'hello\\s*', flags: 'g' })
  assert.equal(del.isError, undefined)

  const content = await fs.readFile(filePath, 'utf-8')
  assert.equal(content, 'tool')

  await fs.rm(root, { recursive: true, force: true })
})

test('file_edit supports clear append replace_all', async () => {
  const { root, watch, filePath } = await setupFile()
  const tool = new FileEditTool(() => ({ watchFolders: [watch] } as any))

  const clear = await tool.execute({ path: 'sample.txt', mode: 'clear' })
  assert.equal(clear.isError, undefined)

  const append = await tool.execute({ path: 'sample.txt', mode: 'append', content: 'abc' })
  assert.equal(append.isError, undefined)

  const replaceAll = await tool.execute({ path: 'sample.txt', mode: 'replace_all', content: 'final' })
  assert.equal(replaceAll.isError, undefined)

  const content = await fs.readFile(filePath, 'utf-8')
  assert.equal(content, 'final')

  await fs.rm(root, { recursive: true, force: true })
})

