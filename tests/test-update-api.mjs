import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let content, readError, state = 'inactive', job = 0, starts = 0, fail = false
globalThis.__updateMocks = {
  async readFile() { if (readError) throw readError; return content },
  stat() {},
  async execa(command) {
    if (command === 'systemctl') return { stdout: `ActiveState=${state}\nJob=${job}` }
    if (fail) throw Error('systemd unavailable')
    starts++
    state = 'activating'
    return { stdout: '' }
  },
}
const text = readFileSync(resolve(process.argv[2], 'packages/xo-server/src/api/xoaHl.mjs'), 'utf8')
  .replace("import { execa } from 'execa'", 'const { execa } = globalThis.__updateMocks')
  .replace("import { readFile, stat } from 'fs/promises'", 'const { readFile, stat } = globalThis.__updateMocks')
const api = await import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'))
readError = { code: 'ENOENT' }
assert.equal((await api.getUpdateStatus()).checked, false)
readError = { code: 'EACCES' }
await assert.rejects(api.getUpdateStatus())
readError = undefined
for (const [verdict, checked] of [['UP_TO_DATE', true], ['AVAILABLE', true], ['ERROR', false], ['BROKEN', false]]) {
  content = verdict + '\ncheckedAt=2026-10-27T00:00:00Z\n'
  assert.equal((await api.getUpdateStatus()).checked, checked)
}
for (const active of ['active', 'activating', 'deactivating', 'reloading']) {
  state = active
  assert.deepEqual(await api.startUpdate(), { started: false, busy: true })
}
state = 'inactive'; job = 42
assert.equal((await api.startUpdate()).busy, true)
job = 0
const results = await Promise.all([api.startUpdate(), api.startUpdate()])
assert.equal(starts, 1)
assert.equal(results.filter(r => r.started).length, 1)
assert.equal(results.filter(r => r.busy).length, 1)
state = 'inactive'; fail = true
await assert.rejects(api.startUpdate())
fail = false
assert.equal((await api.startUpdate()).started, true)
console.log('Update API: missing/invalid/error status, active/pending/concurrent starts and retry passed')
