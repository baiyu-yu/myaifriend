import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { FileWriteTool } from '../../src/main/tools/builtin/file-write'

async function createWatchFolders() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aibot-file-write-'))
  const folderA = path.join(root, 'watch-a')
  const folderB = path.join(root, 'watch-b')
  await fs.mkdir(folderA, { recursive: true })
  await fs.mkdir(folderB, { recursive: true })
  return { root, folderA, folderB }
}

test('file_write writes into selected watch folder', async () => {
  const { root, folderA } = await createWatchFolders()
  const tool = new FileWriteTool(() => ({ watchFolders: [folderA] } as any))

  const result = await tool.execute({ path: 'notes/output.txt', content: 'hello world' })
  assert.equal(result.isError, undefined)

  const writtenPath = path.join(folderA, 'notes', 'output.txt')
  const content = await fs.readFile(writtenPath, 'utf-8')
  assert.equal(content, 'hello world')

  await fs.rm(root, { recursive: true, force: true })
})

test('file_write infers watch folder by relative prefix when multiple watch folders exist', async () => {
  const { root, folderA, folderB } = await createWatchFolders()
  const tool = new FileWriteTool(() => ({ watchFolders: [folderA, folderB] } as any))

  const result = await tool.execute({ path: 'watch-b/report.txt', content: 'from watch-b' })
  assert.equal(result.isError, undefined)

  const writtenPath = path.join(folderB, 'report.txt')
  const content = await fs.readFile(writtenPath, 'utf-8')
  assert.equal(content, 'from watch-b')

  await fs.rm(root, { recursive: true, force: true })
})

test('file_write rejects path escaping watch folder', async () => {
  const { root, folderA, folderB } = await createWatchFolders()
  const tool = new FileWriteTool(() => ({ watchFolders: [folderA, folderB] } as any))

  const result = await tool.execute({
    path: '..\\outside.txt',
    content: 'bad',
    watch_folder: folderA,
  })

  assert.equal(result.isError, true)
  assert.match(result.content, /escapes selected watch_folder|outside watch folders|not inside selected/i)

  await fs.rm(root, { recursive: true, force: true })
})

