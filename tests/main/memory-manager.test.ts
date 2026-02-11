import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { MemoryManager } from '../../src/main/ai/memory-manager'

function resetTestStore() {
  fs.rmSync(path.join(process.cwd(), '.aibot-test-store'), { recursive: true, force: true })
}

test('memory manager merges fragments by ids', () => {
  resetTestStore()
  const manager = new MemoryManager()
  manager.remember('我喜欢简洁回答', 100)
  manager.remember('复杂任务先给结论再补细节', 100)
  const all = manager.list()
  assert.ok(all.length >= 2)

  const merged = manager.merge([all[0].id, all[1].id], 100)
  assert.ok(merged)
  assert.match(merged!.text, /喜欢简洁回答/)
})

test('memory retrieve supports threshold and deduplicate', () => {
  resetTestStore()
  const manager = new MemoryManager()
  manager.remember('我喜欢 TypeScript', 100)
  manager.remember('我喜欢 TypeScript，并且重视类型安全', 100)

  const results = manager.retrieve('TypeScript', 5, 0.1, true)
  assert.ok(results.length >= 1)
  const sourceIds = new Set(results.map((item) => item.sourceId))
  assert.equal(sourceIds.size, results.length)
})
