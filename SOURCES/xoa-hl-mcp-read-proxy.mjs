#!/usr/bin/env node
// Bounded read-only stdio surface around the audited upstream MCP release.
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const READS = new Set(['check_connection', 'list_pools', 'list_hosts', 'list_vms', 'list_srs', 'list_networks', 'get_infrastructure_summary'])
const MAX_BYTES = 4 * 1024 * 1024

export function permittedCall(params) {
  return params && READS.has(params.name) && params.arguments !== null &&
    (params.arguments === undefined || (typeof params.arguments === 'object' && !Array.isArray(params.arguments) && Object.keys(params.arguments).length === 0))
}

export function filteredTools(result) {
  if (!Array.isArray(result?.tools) || result.nextCursor !== undefined) throw new Error('Unexpected tool list')
  const tools = result.tools.filter(tool => READS.has(tool.name))
  if (tools.length !== READS.size || new Set(tools.map(t => t.name)).size !== READS.size) throw new Error('Missing reviewed read tools')
  return { tools: tools.map(tool => ({ ...tool, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } })) }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--mcp-package') throw new Error('Expected --mcp-package DIR')
  const root = resolve(args[1])
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  if (pkg.name !== '@xen-orchestra/mcp' || pkg.version !== '1.1.0' || pkg.bin?.['xo-mcp'] !== './bin/xo-mcp.mjs') throw new Error('Unreviewed MCP package')
  const xo = new URL(process.env.XO_URL)
  if (!['http:', 'https:'].includes(xo.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(xo.hostname) || xo.username || xo.password || xo.search || xo.hash || xo.pathname !== '/') throw new Error('Invalid XO origin')
  if (!process.env.XO_TOKEN && !(process.env.XO_USERNAME && process.env.XO_PASSWORD)) throw new Error('Missing XO credentials')
  const env = { XO_URL: xo.origin, XO_MCP_ENABLE_ACTIONS: '0' }
  for (const key of ['PATH', 'HOME', 'NODE_EXTRA_CA_CERTS']) if (process.env[key]) env[key] = process.env[key]
  if (process.env.XO_TOKEN) env.XO_TOKEN = process.env.XO_TOKEN
  else Object.assign(env, { XO_USERNAME: process.env.XO_USERNAME, XO_PASSWORD: process.env.XO_PASSWORD })
  const guard = resolve(dirname(fileURLToPath(import.meta.url)), 'xoa-hl-mcp-network.mjs')
  const child = spawn(process.execPath, ['--import', guard, resolve(root, 'bin/xo-mcp.mjs')], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map()
  let nextId = 0
  let input = '', output = ''
  let stopping = false
  const emit = value => process.stdout.write(JSON.stringify(value) + '\n')
  const error = (id, message) => emit({ jsonrpc: '2.0', id, error: { code: -32601, message } })
  const stop = () => {
    if (stopping) return
    stopping = true
    for (const request of pending.values()) clearTimeout(request.timer)
    pending.clear()
    child.stdin.end()
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 1000)
    timer.unref()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  process.stdin.on('end', stop)
  process.stdin.on('error', stop)
  process.stdout.on('error', stop)
  child.stdin.on('error', stop)
  child.stderr.resume() // Never relay arbitrary stderr containing credentials.
  child.once('error', () => { process.exitCode = 1; stop() })
  child.once('close', code => {
    for (const request of pending.values()) error(request.id, 'Upstream MCP unavailable')
    if (!stopping) process.exitCode = code || 1
    stop()
    process.stdin.pause()
  })
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    input += chunk
    if (Buffer.byteLength(input) > MAX_BYTES) { process.exitCode = 1; stop(); return }
    let newline
    while ((newline = input.indexOf('\n')) !== -1) {
      const line = input.slice(0, newline); input = input.slice(newline + 1)
      let message
      try { message = JSON.parse(line) } catch { error(null, 'Invalid JSON-RPC'); continue }
      if (!message || message.jsonrpc !== '2.0') { error(null, 'Invalid JSON-RPC'); continue }
      if (message.id === undefined) {
        if (message.method === 'notifications/initialized') child.stdin.write(JSON.stringify(message) + '\n')
        continue
      }
      if (!['initialize', 'ping', 'tools/list', 'tools/call'].includes(message.method) || (message.method === 'tools/call' && !permittedCall(message.params))) {
        error(message.id, 'Tool or method outside the read-only surface'); continue
      }
      if (pending.size >= 16) { error(message.id, 'Too many pending requests'); continue }
      const id = ++nextId
      const timer = setTimeout(() => { pending.delete(id); error(message.id, 'Upstream MCP request timed out') }, 30000)
      pending.set(id, { id: message.id, method: message.method, timer })
      child.stdin.write(JSON.stringify({ ...message, id }) + '\n')
    }
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    output += chunk
    if (Buffer.byteLength(output) > MAX_BYTES) { process.exitCode = 1; stop(); return }
    let newline
    while ((newline = output.indexOf('\n')) !== -1) {
      const line = output.slice(0, newline); output = output.slice(newline + 1)
      let message
      try { message = JSON.parse(line) } catch { process.exitCode = 1; stop(); return }
      if (!message || message.jsonrpc !== '2.0') { process.exitCode = 1; stop(); return }
      if (message.method) {
        // The read-only client authorizes no upstream sampling/elicitation.
        if (message.id !== undefined) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unsupported' } }) + '\n')
        continue
      }
      const request = pending.get(message.id)
      if (!request) continue
      clearTimeout(request.timer); pending.delete(message.id)
      try {
        if (message.error) { error(request.id, 'Upstream MCP error'); continue }
        const result = request.method === 'tools/list' ? filteredTools(message.result) :
          request.method === 'initialize' ? { ...message.result, capabilities: { tools: {} } } : message.result
        emit({ jsonrpc: '2.0', id: request.id, result })
      } catch { error(request.id, 'Unreviewed upstream tool surface') }
    }
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Read-only MCP setup failed'); process.exitCode = 1 })
}
