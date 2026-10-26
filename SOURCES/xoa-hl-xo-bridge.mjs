import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { readInventory } from './xoa-hl-xo-inventory.mjs'

const DATABASE = '/var/lib/xoa-hl/assistant/proposals.sqlite'
const CONFIG = '/etc/xoa-hl/assistant.json'
const COMMAND = '/usr/libexec/xoa-hl/assistant/xoa-hl-proposal-command.py'
const unavailable = () => { throw new Error('assistant_unavailable') }
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 256
function actor(xo) {
  const { user, permission, connection } = xo.apiContext ?? {}
  if (!user || !identity(user.id) || permission !== 'admin' || user.permission !== 'admin' ||
      !connection || connection.get('user_id', undefined) !== user.id) unavailable()
  return { owner: user.id, connection }
}
export async function enabled() {
  try {
    const raw = await readFile(CONFIG)
    return raw.length <= 16384 && JSON.parse(raw).enabled === true
  } catch { return false }
}

// Fixed executable and arguments; private stdin contains trusted identity and
// fresh inventory. No shell, bearer token or browser-supplied state path.
export function proposalCommand(message) {
  const input = JSON.stringify(message)
  if (Buffer.byteLength(input) > 8 * 1024 * 1024 + 65536) return Promise.reject(new Error('assistant_unavailable'))
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0, failed = false
    const child = spawn('/usr/bin/python3', [COMMAND], { env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'ignore'] })
    const timer = setTimeout(() => { failed = true; child.kill('SIGKILL') }, 10000)
    const fail = () => { failed = true; child.kill('SIGKILL') }
    child.on('error', () => { clearTimeout(timer); reject(new Error('assistant_unavailable')) })
    child.stdin.on('error', fail)
    child.stdout.on('data', bytes => {
      size += bytes.length
      if (size > 131072) fail()
      else chunks.push(bytes)
    })
    child.on('close', code => {
      clearTimeout(timer)
      try {
        if (failed || code !== 0) unavailable()
        const response = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (response.ok !== true || !response.result || typeof response.result !== 'object') unavailable()
        resolve(response.result)
      } catch { reject(new Error('assistant_unavailable')) }
    })
    child.stdin.end(input)
  })
}

// This boundary does not select the goose transport. begin/attachWorker are
// private supervisor methods; the API patch only exposes status/get/decide/cancel.
export function createBridge({ isEnabled = enabled, command = proposalCommand, inventory = readInventory, maxSessions = 64 } = {}) {
  const sessions = new WeakMap()
  const gates = new WeakMap()
  const observed = new WeakSet(), disconnected = new WeakSet()
  let count = 0, collecting = 0
  async function acquire(xo) {
    const { owner, connection } = actor(xo)
    if (disconnected.has(connection)) unavailable()
    let state = sessions.get(connection)
    if (state && (state.closed || state.owner !== owner)) { await state.close('disconnected'); state = undefined }
    if (!await isEnabled()) {
      if (state) await state.close('disabled')
      unavailable()
    }
    // Recheck after configuration I/O; sign-out may have run concurrently.
    if (disconnected.has(connection) || actor(xo).owner !== owner) unavailable()
    if (state) return state
    if (count >= maxSessions) unavailable()
    const session = randomBytes(32).toString('hex')
    let active = null, closed = false, queue = Promise.resolve()
    const serial = fn => {
      const result = queue.then(fn)
      queue = result.catch(() => {})
      return result
    }
    const auth = async () => {
      if (closed || disconnected.has(connection) || actor(xo).owner !== owner || actor(xo).connection !== connection || !await isEnabled()) unavailable()
      const user = await xo.getUser(owner)
      if (closed || user?.permission !== 'admin' || actor(xo).owner !== owner) unavailable()
    }
    const call = (action, args) => command({ owner, session, action, ...args })
    const revoke = async reason => {
      const turn = active
      if (turn === null) return
      // Commit the durable revocation before worker cleanup or acknowledgment.
      if (!turn.revoked) { await call('revoke', { turn_id: turn.id, reason }); turn.revoked = true }
      if (turn.stop) await turn.stop()
      if (active === turn) active = null
    }
    state = {
      owner,
      get closed() { return closed },
      begin(request) { return serial(async () => {
        await auth()
        if (typeof request !== 'string' || !request.trim() || request.length > 16384) unavailable()
        await revoke('cancelled')
        const result = await call('begin', { request })
        if (!identity(result.turn_id)) unavailable()
        active = { id: result.turn_id }
        try { await auth() } catch { await revoke('disconnected'); unavailable() }
        return Object.freeze({ owner, session, request, turn_id: active.id, database: DATABASE })
      }) },
      attachWorker(turnId, stop) {
        if (closed || !active || active.revoked || active.id !== turnId || active.stop || typeof stop !== 'function') unavailable()
        active.stop = stop
      },
      workerFinished(turnId) {
        if (active?.id === turnId) active.stop = null
      },
      get(id) { return serial(async () => {
        await auth()
        if (!identity(id)) unavailable()
        const result = await call('get', { id })
        await auth()
        return result
      }) },
      decide(id, decision) { return serial(async () => {
        await auth()
        if (!identity(id) || !['approve', 'reject'].includes(decision)) unavailable()
        if (active?.stop) unavailable()
        // Check ownership and pending state before any expensive platform read.
        const plan = await call('get', { id })
        if (plan.status !== 'pending' || plan.mode !== 'propose_only') unavailable()
        let snapshot = null
        if (decision === 'approve') {
          if (collecting >= 2) unavailable()
          collecting++
          try { snapshot = await inventory(xo) } finally { collecting-- }
        }
        await auth()
        const result = await call('decide', { id, decision, snapshot })
        await auth()
        return result
      }) },
      cancel() { return serial(async () => { await auth(); await revoke('cancelled'); return { cancelled: true } }) },
      close(reason = 'disconnected') {
        closed = true
        return serial(async () => {
          // A failed durable revocation remains retryable; no success is sent.
          await revoke(reason)
          if (sessions.get(connection) === state) { sessions.delete(connection); count-- }
        })
      },
    }
    sessions.set(connection, state); count++
    return state
  }
  function conversation(xo) {
    const { connection } = actor(xo)
    // Observe synchronously, before configuration/queue awaits, so a close
    // during acquisition cannot create an orphaned conversation afterward.
    if (!observed.has(connection)) {
      observed.add(connection)
      connection.once('close', () => {
        disconnected.add(connection)
        const state = sessions.get(connection)
        if (state) void state.close().catch(() => {})
      })
    }
    const next = (gates.get(connection) ?? Promise.resolve()).then(() => acquire(xo))
    gates.set(connection, next.catch(() => {}))
    return next
  }
  return { conversation }
}

const bridge = createBridge()
export const conversation = xo => bridge.conversation(xo)
