import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { READS, permittedCall, filteredTools } from '../SOURCES/xoa-hl-mcp-read-proxy.mjs'

const proxy = resolve('SOURCES/xoa-hl-mcp-read-proxy.mjs')
const guard = resolve('SOURCES/xoa-hl-mcp-network.mjs')
test('surface excludes docs, mutations and argument tricks', () => {
  for (const name of READS) assert.equal(permittedCall({ name, arguments: {} }), true)
  for (const name of ['create_vm', 'delete_vm', 'search_documentation', 'load_skill', 'developer__shell']) assert.equal(permittedCall({ name, arguments: {} }), false)
  for (const arguments_ of [[], null, { command: 'write' }, { filter: 'x' }]) assert.equal(permittedCall({ name: 'list_hosts', arguments: arguments_ }), false)
  const tools = [...READS, 'search_documentation', 'create_vm'].map(name => ({ name, inputSchema: {} }))
  assert.deepEqual(new Set(filteredTools({ tools }).tools.map(t => t.name)), READS)
  assert.throws(() => filteredTools({ tools: [] }))
  assert.throws(() => filteredTools({ tools, nextCursor: 'next' }))
})

test('network guard rejects external docs, writes and unknown XO paths before network IO', async () => {
  const code = `
    await import(${JSON.stringify(guard)});
    for (const [url, options] of [['https://docs.xen-orchestra.com', {}], ['http://127.0.0.1:9000/rest/v0/vms', {method:'POST'}], ['http://127.0.0.1:9000/rest/v0/users', {}]]) {
      try { await fetch(url, options); process.exit(9); } catch(e) { if (!e.message.includes('reviewed read-only')) process.exit(8); }
    }
  `
  const p = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { XO_URL: 'http://127.0.0.1:9000' }, stdio: 'ignore' })
  const code_ = await new Promise(done => p.once('close', done))
  assert.equal(code_, 0)
})

test('MCP relay filters the upstream wire and never forwards blocked calls', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'xoa-read-proxy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(resolve(root, 'bin'))
  await writeFile(resolve(root, 'package.json'), JSON.stringify({ name: '@xen-orchestra/mcp', version: '1.1.0', bin: { 'xo-mcp': './bin/xo-mcp.mjs' } }))
  const childCode = `
    import { createInterface } from 'node:readline';
    if(process.env.NODE_OPTIONS || process.env.XO_MCP_ENABLE_ACTIONS !== '0') process.exit(8);
    const tools = ${JSON.stringify([...READS, 'search_documentation', 'create_vm'])}.map(name=>({name,inputSchema:{}}));
    createInterface({input:process.stdin}).on('line',line=>{
      const m=JSON.parse(line); if(m.id===undefined)return;
      if(m.method==='tools/call'&&!${JSON.stringify([...READS])}.includes(m.params.name))process.exit(9);
      const result=m.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{},prompts:{}}}:m.method==='tools/list'?{tools}:{content:[{type:'text',text:'[]'}]};
      console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
    });
  `
  await writeFile(resolve(root, 'bin/xo-mcp.mjs'), childCode)
  const p = spawn(process.execPath, [proxy, '--mcp-package', root], { env: { XO_URL: 'http://127.0.0.1:9000', XO_TOKEN: 'TEST_TOKEN', XO_MCP_ENABLE_ACTIONS: '1', NODE_OPTIONS: '--throw-deprecation' }, stdio: ['pipe', 'pipe', 'pipe'] })
  const waiting = new Map()
  let id = 0
  const timeout = setTimeout(() => p.kill('SIGKILL'), 5000)
  t.after(() => { clearTimeout(timeout); p.kill('SIGTERM') })
  createInterface({ input: p.stdout }).on('line', line => { const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id) })
  const call = (method, params = {}) => new Promise(done => { const i = ++id; waiting.set(i, done); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n') })
  const init = await call('initialize', {})
  assert.equal(init.result.protocolVersion, '2024-11-05')
  assert.deepEqual(init.result.capabilities, { tools: {} })
  const list = await call('tools/list')
  assert.deepEqual(new Set(list.result.tools.map(t => t.name)), READS)
  for (const name of ['create_vm', 'search_documentation', 'load_skill']) assert.ok((await call('tools/call', { name, arguments: {} })).error)
  assert.ok((await call('resources/read', {})).error)
  assert.ok((await call('tools/call', { name: 'list_hosts', arguments: { command: 'write' } })).error)
  const read = await call('tools/call', { name: 'list_hosts', arguments: {} })
  assert.ok(read.result)
  p.stdin.end()
  assert.equal(await new Promise(done => p.once('close', done)), 0)
})
