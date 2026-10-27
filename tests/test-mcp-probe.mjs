import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { probe } from '../scripts/probe-xo-mcp.mjs'

// Protocol double for failure handling; not an XO compatibility claim.
const fake = `
const { createInterface } = require('node:readline');
const tools = ['check_connection','list_pools','list_hosts','list_vms','list_srs','list_networks','get_infrastructure_summary'];
const mode = process.env.MODE;
createInterface({input: process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (!m.id) return;
  if (mode === 'hang') return;
  if (mode === 'invalid') { console.log('not JSON'); return; }
  if (mode === 'null') { console.log('null'); return; }
  if (mode === 'crash') { console.error('HTTP 404 SECRET_PASSWORD'); process.exit(1); }
  let result;
  if (m.method === 'initialize') result = {protocolVersion:'2024-11-05',capabilities:{tools:{}}};
  else if (m.method === 'tools/list') {
    if (mode === 'cycle') result = {tools:[],nextCursor:'same'};
    else result = {tools:(m.params.cursor ? tools.slice(2) : tools.slice(0,2)).map(name=>({name})), ...(m.params.cursor ? {} : {nextCursor:'next'})};
    if (mode === 'unsafe') result = {tools:[{name:'delete_vm',annotations:{readOnlyHint:true}}]};
  } else {
    if (!tools.includes(m.params.name)) process.exit(9);
    let text = m.params.name === 'check_connection' ? 'Connection to XO server successful.' : m.params.name === 'get_infrastructure_summary' ? JSON.stringify({pools:{total:0},hosts:{total:0},vms:{total:0}}) : '[]';
    if (mode === 'auth') text = 'HTTP 401 SECRET_TOKEN';
    result = {content:[{type:'text',text}],isError:mode === 'auth'};
  }
  console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
});`

for (const [mode, status, failure] of [
  ['ok', 'read_subset_passed', null],
  ['unsafe', 'blocked', 'unreviewed_tool_surface'],
  ['cycle', 'blocked', 'invalid_pagination'],
  ['invalid', 'blocked', 'invalid_json_rpc'],
  ['null', 'blocked', 'invalid_json_rpc'],
  ['crash', 'blocked', 'http_404'],
  ['hang', 'blocked', 'timeout'],
  ['auth', 'read_subset_failed', null],
]) {
  test(`protocol: ${mode}`, async () => {
    const report = await probe({ command: [process.execPath, '-e', fake], env: { MODE: mode }, timeoutMs: mode === 'hang' ? 150 : 5000 })
    assert.equal(report.status, status)
    assert.equal(report.failure, failure)
    assert.ok(!JSON.stringify(report).includes('SECRET'))
    if (mode === 'unsafe') assert.equal(report.calls.length, 0)
    if (mode === 'ok') assert.equal(report.calls.length, 7)
    if (mode === 'auth') assert.ok(report.calls.every(c => c.reason === 'authentication'))
  })
}

const script = resolve('scripts/probe-xo-mcp.mjs')
async function runCli(root, url, output) {
  const child = spawn(process.execPath, [script, '--mcp-package', root, '--target-kind', 'fixture', '--output', output], {
    env: { PATH: process.env.PATH, XO_URL: url, XO_TOKEN: 'SECRET_TOKEN', XO_MCP_ENABLE_ACTIONS: '1', NO_PROXY: '*' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let text = ''
  child.stdout.on('data', chunk => { text += chunk })
  child.stderr.on('data', chunk => { text += chunk })
  const [code] = await once(child, 'close')
  assert.ok(!text.includes('SECRET'))
  const report = JSON.parse(await readFile(output, 'utf8'))
  assert.ok(!JSON.stringify(report).includes('SECRET'))
  return { code, report }
}

// Exercise the real published binaries, not a reimplementation of MCP.
// Fixture is a small legacy REST contract, NOT a running XO 5.113.2 instance.
for (const [version, envKey] of [['1.1.0', 'XO_MCP_110_ROOT'], ['1.4.3', 'XO_MCP_143_ROOT']]) {
  test(`published MCP ${version} vs synthetic legacy REST fixture`, { skip: !process.env[envKey] }, async t => {
    const requests = []
    let denyAuth = false
    const api = createServer((req, res) => {
      requests.push({ method: req.method, path: new URL(req.url, 'http://fixture').pathname })
      assert.equal(req.method, 'GET')
      res.setHeader('content-type', 'application/json')
      const path = new URL(req.url, 'http://fixture').pathname
      if (path === '/rest/v0/mcp/status') { res.writeHead(404); res.end('{}'); return }
      if (req.headers.cookie !== 'authenticationToken=SECRET_TOKEN' || denyAuth) { res.writeHead(401); res.end('{}'); return }
      const inventory = {
        '/rest/v0/pools': [{ id: 'pool', name_label: 'SECRET_INVENTORY' }],
        '/rest/v0/hosts': [{ id: 'host', name_label: 'SECRET_INVENTORY', power_state: 'Running' }],
        '/rest/v0/vms': [{ id: 'vm', name_label: 'SECRET_INVENTORY', power_state: 'Halted' }],
        '/rest/v0/srs': [{ id: 'sr', name_label: 'SECRET_INVENTORY' }],
        '/rest/v0/networks': [{ id: 'net', name_label: 'SECRET_INVENTORY' }],
      }
      if (!Object.hasOwn(inventory, path)) { res.writeHead(404); res.end('{}'); return }
      res.end(JSON.stringify(inventory[path]))
    })
    api.listen(0, '127.0.0.1')
    await once(api, 'listening')
    const dir = await mkdtemp(resolve(tmpdir(), 'xo-mcp-probe-'))
    t.after(async () => { api.closeAllConnections(); await new Promise(done => api.close(done)); await rm(dir, { recursive: true, force: true }) })
    const url = `http://127.0.0.1:${api.address().port}`
    const { code, report } = await runCli(process.env[envKey], url, resolve(dir, 'report.json'))
    assert.equal(report.mcp_version, version)
    assert.equal(report.target_version_verified, false)
    assert.equal(report.target_kind, 'fixture')
    assert.equal(report.expected_xo_commit, 'e281c536d3b1e97ccfb3b0826f91b7dbb6c4478c')
    if (version === '1.1.0') {
      assert.equal(code, 0)
      assert.equal(report.status, 'read_subset_passed')
      assert.equal(report.calls.length, 7)
      assert.ok(report.skipped.includes('search_documentation'))
      assert.ok(requests.every(r => !r.path.includes('mcp/status')))
      denyAuth = true
      const denied = await runCli(process.env[envKey], url, resolve(dir, 'denied.json'))
      assert.equal(denied.code, 1)
      assert.ok(denied.report.calls.every(c => c.status === 'error' && c.reason === 'authentication'))
    } else {
      assert.equal(code, 1)
      assert.equal(report.failure, 'http_404')
      assert.equal(report.calls.length, 0)
      assert.deepEqual(requests, [{ method: 'GET', path: '/rest/v0/mcp/status' }])
    }
  })
}
