import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

const source = readFileSync(resolve(process.argv[2], 'packages/xo-server/src/index.mjs'), 'utf8')
const start = source.indexOf('  try {\n    // Release payloads')
assert.ok(start >= 0)
const block = source.slice(start, source.indexOf('\n  log.info(`Starting', start)).replaceAll('import.meta.url', "'file:///opt/xo/packages/xo-server/dist/index.mjs'")
for (const [stamp, git, warnings, expectedCalls] of [
  ['e281c53\n', 'wrong', 0, 0],
  [undefined, 'e281c53', 0, 1],
  ['different\n', 'e281c53', 1, 0],
]) {
  let calls = 0
  const logs = []
  await vm.runInNewContext(`(async () => {${block}})()`, {
    URL, __GIT_COMMIT__: 'e281c53', execFile: {},
    fse: { async readFile() { if (stamp === undefined) throw { code: 'ENOENT' }; return stamp } },
    async fromCallback() { calls++; return Buffer.from(git) },
    log: { warn(...args) { logs.push(args) } },
  })
  assert.equal(calls, expectedCalls)
  assert.equal(logs.length, warnings)
}
console.log('Runtime stamp: packaged payload, source checkout and stale stamp passed')
