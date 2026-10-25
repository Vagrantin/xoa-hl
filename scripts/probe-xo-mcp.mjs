#!/usr/bin/env node
// Phase 0 of Vagrantin/xcp-hl#80. No SDK, model or appliance changes required.
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const READ_CALLS = [
  'check_connection', 'list_pools', 'list_hosts', 'list_vms',
  'list_srs', 'list_networks', 'get_infrastructure_summary',
]
const KNOWN_TOOLS = new Set([
  ...READ_CALLS, 'search_documentation', 'list_vdis', 'get_pool_dashboard',
  'get_vm_details', 'get_sr_details', 'get_network_details',
])
const MAX_BYTES = 4 * 1024 * 1024

// Never return server messages, URLs, inventory, or stderr in the report.
function category(text) {
  if (/401|403|authentication|credentials/i.test(text)) return 'authentication'
  if (/MCP disabled by admin|mcp_disabled/i.test(text)) return 'mcp_disabled'
  if (/404/.test(text)) return 'http_404'
  return 'server_error'
}

export async function probe({ command, env, timeoutMs = 30_000 }) {
  const report = { status: 'incomplete', tools: [], calls: [], skipped: [], failure: null }
  const child = spawn(command[0], command.slice(1), { env, stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map()
  let nextId = 0
  let buffer = ''
  let totalBytes = 0
  let stderr = ''
  let ended = false
  let failure
  const fail = code => {
    failure ??= code
    for (const { reject } of pending.values()) reject(new Error(failure))
    pending.clear()
  }
  const closed = new Promise(resolveClose => {
    child.once('close', () => { ended = true; fail(failure ?? category(stderr)); resolveClose() })
  })
  child.once('error', () => fail('spawn_failed'))
  child.stdin.on('error', () => fail('stdin_closed'))
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192) })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    totalBytes += Buffer.byteLength(chunk)
    if (totalBytes > MAX_BYTES) { fail('output_limit'); child.kill(); return }
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (!line.trim()) continue
      let message
      try { message = JSON.parse(line) } catch { fail('invalid_json_rpc'); child.kill(); return }
      if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') { fail('invalid_json_rpc'); child.kill(); return }
      // No server-initiated request (sampling, elicitation, etc.) is authorised.
      if (message.method !== undefined) {
        if (message.id !== undefined) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unsupported' } }) + '\n')
        }
        continue
      }
      const request = pending.get(message.id)
      if (!request) continue
      pending.delete(message.id)
      if (message.error) request.reject(new Error('rpc_error'))
      else request.resolve(message.result)
    }
  })
  const send = (method, params) => {
    if (failure || ended) return Promise.reject(new Error(failure ?? 'server_closed'))
    const id = ++nextId
    return new Promise((resolveRequest, reject) => {
      pending.set(id, { resolve: resolveRequest, reject })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }
  // One deadline for the entire probe, including initialization and pagination.
  const deadline = setTimeout(() => { fail('timeout'); child.kill() }, timeoutMs)
  try {
    const initialized = await send('initialize', {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'xoa-hl-phase0-probe', version: '1.0.0' },
    })
    if (!initialized?.protocolVersion || !initialized?.capabilities?.tools) throw new Error('invalid_initialize')
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    const cursors = new Set()
    let cursor
    do {
      const result = await send('tools/list', cursor === undefined ? {} : { cursor })
      if (!Array.isArray(result?.tools)) throw new Error('invalid_tools_list')
      for (const tool of result.tools) {
        if (typeof tool?.name !== 'string' || report.tools.includes(tool.name)) throw new Error('invalid_tools_list')
        report.tools.push(tool.name)
      }
      cursor = result.nextCursor
      if (cursor !== undefined) {
        if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('invalid_pagination')
        cursors.add(cursor)
      }
    } while (cursor !== undefined)
    // Fail closed on a changed surface, even when a new tool claims readOnlyHint.
    if (report.tools.some(name => !KNOWN_TOOLS.has(name))) throw new Error('unreviewed_tool_surface')
    report.skipped = report.tools.filter(name => !READ_CALLS.includes(name))
    for (const name of READ_CALLS) {
      if (!report.tools.includes(name)) { report.calls.push({ name, status: 'missing' }); continue }
      try {
        const result = await send('tools/call', { name, arguments: {} })
        if (!Array.isArray(result?.content)) throw new Error('invalid_tool_result')
        // Require the inspected connection success marker as well as no isError.
        const text = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
        const connectionFailed = name === 'check_connection' && text !== 'Connection to XO server successful.'
        if (result.isError === true || connectionFailed) {
          report.calls.push({ name, status: 'error', reason: category(text) })
          continue
        }
        if (name !== 'check_connection') {
          const value = JSON.parse(text)
          if (name === 'get_infrastructure_summary') {
            if (!['pools', 'hosts', 'vms'].every(key => Number.isInteger(value?.[key]?.total) && value[key].total >= 0)) throw new Error('invalid_tool_result')
          } else if (!Array.isArray(value)) throw new Error('invalid_tool_result')
        }
        report.calls.push({ name, status: 'ok' })
      } catch (error) {
        if (failure) throw error
        report.calls.push({ name, status: 'error' })
      }
    }
    report.status = report.calls.every(call => call.status === 'ok') ? 'read_subset_passed' : 'read_subset_failed'
  } catch (error) {
    report.status = 'blocked'
    report.failure = failure ?? error.message
  } finally {
    clearTimeout(deadline)
    child.stdin.end()
    if (!ended) child.kill('SIGTERM')
    const force = setTimeout(() => child.kill('SIGKILL'), 1000)
    await closed
    clearTimeout(force)
  }
  return report
}

export async function main(args = process.argv.slice(2)) {
  const usage = 'Usage: node scripts/probe-xo-mcp.mjs --mcp-package DIR --target-kind appliance|fixture [--output FILE] [--timeout-ms N]'
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(usage + '\n'); return 0 }
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!['--mcp-package', '--target-kind', '--output', '--timeout-ms'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error(usage)
    options[args[i]] = args[i + 1]
  }
  if (!options['--mcp-package'] || !['appliance', 'fixture'].includes(options['--target-kind'])) throw new Error(usage)
  const timeoutMs = Number(options['--timeout-ms'] ?? 30_000)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) throw new Error('Invalid timeout')
  const root = resolve(options['--mcp-package'])
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  if (pkg.name !== '@xen-orchestra/mcp' || !['1.1.0', '1.4.3'].includes(pkg.version) || pkg.bin?.['xo-mcp'] !== './bin/xo-mcp.mjs') {
    throw new Error('Expected audited @xen-orchestra/mcp 1.1.0 or 1.4.3 package')
  }
  const { XO_URL, XO_TOKEN, XO_USERNAME, XO_PASSWORD } = process.env
  if (!XO_URL || (!XO_TOKEN && !(XO_USERNAME && XO_PASSWORD))) throw new Error('Set XO_URL and XO_TOKEN (or XO_USERNAME and XO_PASSWORD)')
  const url = new URL(XO_URL)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid XO_URL')
  // Minimal child environment: no inherited XO actions, TLS bypass, NODE_OPTIONS,
  // preload hooks, or cloud/model credentials. Respect operator CA/proxy settings.
  const env = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'SystemRoot', 'NODE_EXTRA_CA_CERTS', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  Object.assign(env, { XO_URL, XO_MCP_ENABLE_ACTIONS: '0' }, XO_TOKEN ? { XO_TOKEN } : { XO_USERNAME, XO_PASSWORD })
  const pin = await readFile(new URL('../UPSTREAM_XO', import.meta.url), 'utf8')
  const report = {
    schema_version: 1, target_kind: options['--target-kind'],
    expected_xo_commit: pin.match(/^XO_COMMIT=(\w+)$/m)?.[1],
    expected_xo_version: pin.match(/^XO_VERSION=(\S+)$/m)?.[1],
    target_version_verified: false,
    mcp_version: pkg.version, node_version: process.version,
    measured_at: new Date().toISOString(),
    ...await probe({ command: [process.execPath, resolve(root, 'bin/xo-mcp.mjs')], env, timeoutMs }),
  }
  const json = JSON.stringify(report, null, 2) + '\n'
  if (options['--output']) await writeFile(options['--output'], json, { mode: 0o600, flag: 'wx' })
  else process.stdout.write(json)
  return report.status === 'read_subset_passed' ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code }).catch(() => {
    // Setup exceptions can contain URL credentials or private filesystem paths.
    console.error('Probe setup failed. Check arguments, package path, XO credentials, and output path. See docs/mcp-phase0.md.')
    process.exitCode = 2
  })
}
