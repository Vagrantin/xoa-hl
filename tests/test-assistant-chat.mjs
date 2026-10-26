import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { createAssistantChat } from '../SOURCES/assistant-ui/chat.mjs'
import { messages } from '../SOURCES/assistant-ui/locales.mjs'
const require = createRequire(import.meta.url)
const { parseHTML } = require(process.env.ASSISTANT_DOM_MODULE ?? 'linkedom')
const flush = () => new Promise(done => setImmediate(done))
const spec = { name: 'test', template: 'Alma', vcpus: 2, memory_mb: 2048, disk_gb: 20, host: 'host', sr: 'sr', network: 'lan' }
const plan = { id: 'test-proposal-123456789012', digest: 'a'.repeat(64), expires_at: Date.now() / 1000 + 300,
  status: 'pending', mode: 'propose_only', created: false, live_execution_available: false, spec }
function setup(bridge = {}, locale = 'en') {
  const { document, window } = parseHTML('<html><body></body></html>')
  const chat = createAssistantChat({ document, locale, enabled: true, autoRefresh: false,
    bridge: { cancel: async () => {}, decide: async () => ({ ...plan, status: 'approved_dry_run' }),
      send: async (_, { onEvent }) => { onEvent({ type: 'text', text: 'response' }); onEvent({ type: 'done' }) }, ...bridge } })
  document.body.append(chat.element)
  return { document, window, chat, send: document.querySelector('.xoa-assistant__send'),
    stop: document.querySelector('.xoa-assistant__stop'), input: document.querySelector('textarea'),
    approve: document.querySelector('.xoa-assistant__approve'), status: document.querySelector('.xoa-assistant__connection-status') }
}

for (const locale of ['en', 'fr', 'ja']) test(`request form is localized in ${locale}`, async () => {
  const ui = setup({}, locale)
  assert.equal(ui.send.textContent, messages[locale].send)
  assert.equal(ui.input.getAttribute('aria-label'), messages[locale].requestLabel)
  assert.equal(await ui.chat.submit('test'), true)
  assert.ok(ui.document.body.textContent.includes('response')); ui.chat.destroy()
})

test('disabled feature creates no component or bridge calls', () => {
  assert.equal(createAssistantChat({ enabled: false }).element, null)
})

test('authenticated cancellation barrier precedes every new turn', async () => {
  const calls = []; let release
  const ui = setup({ cancel: () => { calls.push('cancel'); return new Promise(done => { release = done }) },
    send: async (payload, { onEvent }) => { calls.push(payload); onEvent({ type: 'done' }) } })
  const pending = ui.chat.submit('  <script>unsafe</script>  ')
  await flush(); assert.deepEqual(calls, ['cancel']); assert.equal(ui.send.disabled, true)
  release(); assert.equal(await pending, true)
  assert.deepEqual(calls[1], { text: '<script>unsafe</script>', locale: 'en' })
  assert.equal(ui.document.querySelectorAll('script').length, 0); ui.chat.destroy()
})

test('proposal approval stays disabled until the complete reply arrives', async () => {
  let finish
  const ui = setup({ send: (_, { onEvent }) => {
    onEvent({ type: 'text', text: 'first ' }); onEvent({ type: 'proposal', proposal: plan })
    return new Promise(done => { finish = () => { onEvent({ type: 'text', text: 'last' }); onEvent({ type: 'done' }); done() } })
  } })
  const pending = ui.chat.submit('test'); await flush()
  assert.equal(ui.approve.disabled, true); assert.equal(ui.stop.disabled, false)
  assert.equal(await ui.chat.submit('overlap'), false)
  finish(); assert.equal(await pending, true); assert.equal(ui.approve.disabled, false)
  assert.ok(ui.document.body.textContent.includes('first last')); ui.chat.destroy()
})

test('stop ignores late text and requires acknowledged server cancellation', async () => {
  let emit, finish, signal, cancelCalls = 0, acknowledge
  const ui = setup({ cancel: () => { cancelCalls++; return cancelCalls === 1 ? Promise.resolve() : new Promise(done => { acknowledge = done }) },
    send: (_, options) => { emit = options.onEvent; signal = options.signal; return new Promise(done => { finish = done }) } })
  const pending = ui.chat.submit('test'); await flush()
  const stopping = ui.chat.cancel(); emit({ type: 'text', text: 'STALE' }); await flush()
  assert.equal(signal.aborted, true); assert.equal(ui.send.disabled, true)
  assert.equal(await ui.chat.submit('too soon'), false)
  acknowledge(); assert.equal(await stopping, true); finish(); assert.equal(await pending, false)
  assert.ok(!ui.document.body.textContent.includes('STALE')); assert.equal(ui.send.disabled, false); ui.chat.destroy()
})

test('failed cancellation locks sending until Stop succeeds', async () => {
  let fail = true
  const ui = setup({ cancel: async () => { if (fail) throw new Error('private context') } })
  assert.equal(await ui.chat.submit('test'), false)
  assert.equal(ui.send.disabled, true); assert.equal(ui.stop.disabled, false)
  assert.equal(ui.status.textContent, messages.en.cancelFailed)
  assert.ok(!ui.document.body.textContent.includes('private context'))
  fail = false; assert.equal(await ui.chat.cancel(), true); assert.equal(ui.send.disabled, false); ui.chat.destroy()
})

test('truncated, malformed or oversized replies invalidate any proposal', async () => {
  for (const event of [null, { type: 'unknown' }, { type: 'text', text: 'x'.repeat(8193) }, { type: 'proposal', proposal: { ...plan, created: true } }, undefined]) {
    let cancellations = 0
    const ui = setup({ cancel: async () => { cancellations++ }, send: async (_, { onEvent }) => {
      onEvent({ type: 'proposal', proposal: plan }); if (event !== undefined) onEvent(event)
    } })
    assert.equal(await ui.chat.submit('test'), false)
    assert.equal(cancellations, 2); assert.equal(ui.approve.disabled, true)
    assert.equal(ui.status.textContent, messages.en.connectionFailed); ui.chat.destroy()
  }
})

test('invalid input sends nothing; form submission uses current text', async () => {
  const calls = []
  const ui = setup({ send: async (payload, { onEvent }) => { calls.push(payload); onEvent({ type: 'done' }) } })
  assert.equal(await ui.chat.submit(' '), false); assert.equal(await ui.chat.submit('x'.repeat(16385)), false)
  assert.equal(calls.length, 0)
  ui.input.value = 'from the form'
  ui.document.querySelector('form').dispatchEvent(new ui.window.Event('submit', { cancelable: true }))
  await flush(); assert.deepEqual(calls, [{ text: 'from the form', locale: 'en' }]); ui.chat.destroy()
})

test('destroy aborts the active turn and asks the server to invalidate plans', async () => {
  let emit, finish, signal, cancellations = 0
  const ui = setup({ cancel: async () => { cancellations++ }, send: (_, options) => {
    emit = options.onEvent; signal = options.signal; return new Promise(done => { finish = done })
  } })
  const pending = ui.chat.submit('test'); await flush(); ui.chat.destroy(); await flush()
  assert.equal(signal.aborted, true); assert.equal(cancellations, 2)
  emit({ type: 'proposal', proposal: plan }); finish(); assert.equal(await pending, false)
  assert.equal(ui.document.querySelector('.xoa-assistant'), null)
})


test('aggregate stream limit invalidates a proposal even with small chunks', async () => {
  const ui = setup({ send: async (_, { onEvent }) => {
    onEvent({ type: 'proposal', proposal: plan })
    for (let i = 0; i < 9; i++) onEvent({ type: 'text', text: 'x'.repeat(8192) })
    onEvent({ type: 'done' })
  } })
  assert.equal(await ui.chat.submit('test'), false)
  assert.equal(ui.approve.disabled, true); ui.chat.destroy()
})

test('a pending decision blocks new turns and Stop until settled', async () => {
  let finish
  const ui = setup({ decide: () => new Promise(resolve => { finish = resolve }),
    send: async (_, { onEvent }) => { onEvent({ type: 'proposal', proposal: plan }); onEvent({ type: 'done' }) } })
  await ui.chat.submit('test'); ui.approve.click(); await flush()
  assert.equal(ui.send.disabled, true); assert.equal(ui.stop.disabled, true)
  assert.equal(await ui.chat.submit('correction'), false)
  finish({ ...plan, status: 'approved_dry_run' }); await flush()
  assert.equal(ui.send.disabled, false); ui.chat.destroy()
})
