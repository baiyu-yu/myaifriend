import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

test('packaged startup entry exists after main build', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { main: string }
  const entry = path.join(process.cwd(), pkg.main)
  assert.equal(fs.existsSync(entry), true)
})
