import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createBridge } from '../SOURCES/xoa-hl-xo-bridge.mjs'

function fixture(options = {}) {
  const events = [], commands = []
  let turn = 0, allowed = true, enabled = true
  const connection = new EventEmitter(); connection.user = 'alice'
  connection.get = () => connection.user
  const xo = { apiContext: { user: { id: 'alice', permission: 'admin' }, permission: 'admin', connection },
    getUser: async () => ({ permission: allowed ? 'admin' : 'read' }) }
  const command = async message => {
    commands.push(message); events.push(message.action)
    if (message.action === 'begin') return { turn_id: 'turn-' + ++turn }
    if (message.action === 'get') {
      if (message.id === 'foreign') throw new Error('private error')
      return { id: message.id, status: 'pending', mode: 'propose_only' }
    }
    if (message.action === 'decide') return { id: message.id, status: 'approved_dry_run', created: false }
    return { revoked: true }
  }
  const bridge = createBridge({ isEnabled: async () => enabled, command,
    inventory: async () => { events.push('inventory'); return { fresh: true } }, ...options })
  return { xo, bridge, command, commands, events, connection, disable: () => { enabled = false },
    demote: () => { allowed = false } }
}
test('disabled or unauthenticated callers never start a command', async () => {
  for (const change of [f => f.disable(), f => { f.xo.apiContext = undefined },
    f => { f.xo.apiContext.permission = 'read' }, f => { f.connection.user = undefined }]) {
    const f = fixture(); change(f)
    await assert.rejects(async () => f.bridge.conversation(f.xo), /assistant_unavailable/)
    assert.equal(f.commands.length, 0)
  }
})
test('simultaneous acquisition shares one bounded authenticated conversation', async () => {
  const f = fixture({ maxSessions: 1 })
  const [a, b] = await Promise.all([f.bridge.conversation(f.xo), f.bridge.conversation(f.xo)])
  assert.equal(a, b)
  const context = await a.begin('日本語のリクエスト')
  assert.equal(context.owner, 'alice'); assert.equal(context.request, '日本語のリクエスト')
  assert.match(context.session, /^[a-f0-9]{64}$/); assert.equal(Object.isFrozen(context), true)
  assert.equal(f.commands[0].session, context.session)
})
test('approval resolves ownership first and uses fresh server inventory', async () => {
  const f = fixture(), c = await f.bridge.conversation(f.xo)
  await c.begin('a VM')
  const result = await c.decide('proposal', 'approve')
  assert.equal(result.created, false)
  assert.deepEqual(f.events, ['begin', 'get', 'inventory', 'decide'])
  assert.deepEqual(f.commands.at(-1).snapshot, { fresh: true })
  assert.equal(f.commands.at(-1).owner, 'alice')
})
test('foreign proposal and invalid decisions cannot trigger inventory/approval', async () => {
  const f = fixture(), c = await f.bridge.conversation(f.xo)
  await assert.rejects(c.decide('foreign', 'approve'))
  await assert.rejects(c.decide('proposal', 'yes'), /assistant_unavailable/)
  assert.deepEqual(f.events, ['get'])
})
test('rejection uses no inventory', async () => {
  const f = fixture(), c = await f.bridge.conversation(f.xo)
  await c.decide('proposal', 'reject')
  assert.deepEqual(f.events, ['get', 'decide'])
  assert.equal(f.commands.at(-1).snapshot, null)
})
test('cancellation durably revokes before stopping worker and acknowledging', async () => {
  const f = fixture(), c = await f.bridge.conversation(f.xo)
  const context = await c.begin('a VM')
  c.attachWorker(context.turn_id, async () => f.events.push('stop'))
  assert.deepEqual(await c.cancel(), { cancelled: true })
  f.events.push('ack')
  assert.deepEqual(f.events, ['begin', 'revoke', 'stop', 'ack'])
  assert.throws(() => c.attachWorker(context.turn_id, async () => {}), /assistant_unavailable/)
})
test('failed worker cleanup keeps cancellation blocked and retryable', async () => {
  const f = fixture(), c = await f.bridge.conversation(f.xo), context = await c.begin('a VM')
  let attempts = 0
  c.attachWorker(context.turn_id, async () => { if (++attempts === 1) throw new Error('still running') })
  await assert.rejects(c.cancel(), /still running/)
  await c.cancel()
  assert.equal(attempts, 2); assert.equal(f.events.filter(e => e === 'revoke').length, 1)
})
test('failed durable revocation cannot stop worker or acknowledge cancellation', async () => {
  let failing = true
  const f = fixture({ command: async message => {
    if (message.action === 'begin') return { turn_id: 'turn' }
    if (failing) throw new Error('database unavailable')
    return { revoked: true }
  } })
  const c = await f.bridge.conversation(f.xo), context = await c.begin('a VM')
  let stopped = false
  c.attachWorker(context.turn_id, async () => { stopped = true })
  await assert.rejects(c.cancel()); assert.equal(stopped, false)
  failing = false; await c.cancel(); assert.equal(stopped, true)
})
test('decisions stay blocked while worker runs; stale completion cannot detach replacement', async () => {
  const f = fixture(), c = await f.bridge.conversation(f.xo), first = await c.begin('first')
  c.attachWorker(first.turn_id, async () => {})
  await assert.rejects(c.decide('proposal', 'approve'), /assistant_unavailable/)
  const second = await c.begin('second')
  c.attachWorker(second.turn_id, async () => {})
  c.workerFinished(first.turn_id)
  await assert.rejects(c.decide('proposal', 'approve'), /assistant_unavailable/)
  c.workerFinished(second.turn_id)
  await c.decide('proposal', 'approve')
})
test('logout during turn startup revokes its durable turn', async () => {
  const f = fixture({ command: async message => {
    f.events.push(message.action)
    if (message.action === 'begin') { f.connection.user = undefined; return { turn_id: 'turn' } }
    return { revoked: true }
  } })
  const c = await f.bridge.conversation(f.xo)
  await assert.rejects(c.begin('a VM'), /assistant_unavailable/)
  assert.deepEqual(f.events, ['begin', 'revoke'])
})
test('role revocation while inventory is read prevents committing the decision', async () => {
  const f = fixture({ inventory: async () => { f.demote(); return { fresh: true } } })
  const c = await f.bridge.conversation(f.xo)
  await assert.rejects(c.decide('proposal', 'approve'), /assistant_unavailable/)
  assert.deepEqual(f.events, ['get'])
})
test('disable revokes pending turn and closes authenticated conversation', async () => {
  const f = fixture(), c = await f.bridge.conversation(f.xo), context = await c.begin('a VM')
  c.attachWorker(context.turn_id, async () => f.events.push('stop'))
  f.disable()
  await assert.rejects(f.bridge.conversation(f.xo), /assistant_unavailable/)
  assert.equal(c.closed, true)
  assert.equal(f.commands.at(-1).reason, 'disabled')
  assert.deepEqual(f.events, ['begin', 'revoke', 'stop'])
})
test('connection close cleans up only its own identity and releases capacity', async () => {
  const f = fixture({ maxSessions: 1 }), c = await f.bridge.conversation(f.xo)
  await c.begin('a VM'); f.connection.emit('close')
  await c.close()
  assert.equal(c.closed, true)
  assert.equal(f.commands.at(-1).reason, 'disconnected')
  await assert.rejects(f.bridge.conversation(f.xo), /assistant_unavailable/)
  const next = fixture()
  assert.notEqual(await f.bridge.conversation(next.xo), c)
})
test('disconnect during asynchronous acquisition never creates a conversation', async () => {
  let configured
  const f = fixture({ isEnabled: () => new Promise(resolve => { configured = resolve }) })
  const pending = f.bridge.conversation(f.xo)
  await new Promise(resolve => setImmediate(resolve))
  f.connection.emit('close'); configured(true)
  await assert.rejects(pending, /assistant_unavailable/)
  assert.equal(f.commands.length, 0)
})
test('published API patch exposes only authenticated propose-only lifecycle methods', async () => {
  const patch = await readFile(new URL('../patches/xoa-hl-assistant-api.patch', import.meta.url), 'utf8')
  const source = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1)).join('\n')
  const api = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
  assert.deepEqual(Object.keys(api).sort(), ['cancel', 'decideProposal', 'getProposal', 'getState'])
  for (const name of ['cancel', 'decideProposal', 'getProposal']) assert.equal(api[name].permission, 'admin')
  assert.deepEqual(Object.keys(api.decideProposal.params).sort(), ['decision', 'id'])
  assert.deepEqual(await api.getState.call({ apiContext: { permission: 'read' } }), { enabled: false, chat_available: false, live_execution_available: false })
  assert.deepEqual(await api.getState.call({ apiContext: { permission: 'admin' } }), { enabled: false, chat_available: false, live_execution_available: false })
  await assert.rejects(api.decideProposal.call({}, { id: 'test', decision: 'approve' }), /assistant_unavailable/)
})
