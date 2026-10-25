import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { createAssistantPanel } from '../SOURCES/assistant-ui/panel.mjs'
import { messages } from '../SOURCES/assistant-ui/locales.mjs'
const require = createRequire(import.meta.url)
const { parseHTML } = require(process.env.ASSISTANT_DOM_MODULE ?? 'linkedom')

const spec = { name: 'build-test', template: 'AlmaLinux 9', vcpus: 2, memory_mb: 2048, disk_gb: 20, host: 'host-a', sr: 'local', network: 'LAN', tags: ['lab'] }
const plan = (extra = {}) => ({ id: 'opaque-proposal-1234567890', digest: 'a'.repeat(64), expires_at: 1300,
  status: 'pending', mode: 'propose_only', created: false, live_execution_available: false, spec: { ...spec }, ...extra })
function setup(options = {}) {
  const { document, window } = parseHTML('<html><body></body></html>')
  const panel = createAssistantPanel({ document, enabled: true, clock: () => 1000000, autoRefresh: false, onDecision: async () => plan({ status: 'approved_dry_run' }), ...options })
  if (panel.element) document.body.append(panel.element)
  return { document, window, panel, approve: document.querySelector('.xoa-assistant__approve'), reject: document.querySelector('.xoa-assistant__reject'), status: document.querySelector('[role=status]') }
}
const flush = () => new Promise(done => setImmediate(done))

for (const locale of ['en', 'fr', 'ja']) test(`full specification and decision labels in ${locale}`, () => {
  const ui = setup({ locale }); assert.equal(ui.panel.showProposal(plan()), true)
  assert.equal(ui.approve.textContent, messages[locale].approve)
  assert.equal(ui.reject.textContent, messages[locale].reject)
  assert.ok(ui.document.body.textContent.includes(messages[locale].proposeOnly))
  for (const key of Object.keys(spec)) assert.ok(ui.document.body.textContent.includes(String(Array.isArray(spec[key]) ? spec[key].join(', ') : spec[key])))
  assert.equal(ui.document.querySelectorAll('dt').length, 9)
  ui.panel.destroy()
})

test('feature stays absent unless explicitly enabled', () => {
  for (const enabled of [undefined, false, 'false', 'true', 1]) assert.equal(createAssistantPanel({ enabled }).element, null)
})

test('regional locale and unsupported locale are deterministic', () => {
  const fr = setup({ locale: 'fr-FR' }); assert.equal(fr.panel.element.lang, 'fr'); fr.panel.destroy()
  const fallback = setup({ locale: 'unsupported' }); assert.equal(fallback.panel.element.lang, 'en'); fallback.panel.destroy()
})

test('streamed and resource content is rendered as text, never HTML', () => {
  const ui = setup()
  ui.panel.appendAssistantText('<img src=x onerror=alert(1)>')
  ui.panel.appendAssistantText(' next chunk')
  ui.panel.showProposal(plan({ spec: { ...spec, network: '<script>write()</script>' } }))
  assert.equal(ui.document.querySelectorAll('img,script').length, 0)
  assert.ok(ui.document.body.textContent.includes('<script>write()</script>'))
  assert.ok(ui.document.body.textContent.includes('next chunk'))
  ui.panel.destroy()
})

test('approval sends only the opaque ID and decision, once while pending', async () => {
  const calls = []; let complete
  const ui = setup({ onDecision: payload => { calls.push(payload); return new Promise(done => { complete = done }) } })
  ui.panel.showProposal(plan())
  ui.approve.dispatchEvent(new ui.window.Event('click')); ui.approve.dispatchEvent(new ui.window.Event('click'))
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { id: plan().id, decision: 'approve' })
  assert.equal(ui.approve.disabled, true)
  complete(plan({ status: 'approved_dry_run' })); await flush()
  assert.equal(ui.approve.disabled, true)
  assert.equal(ui.status.textContent, messages.en.approved_dry_run)
  ui.panel.destroy()
})

test('rejection is explicit and closes further decisions', async () => {
  let called
  const ui = setup({ onDecision: async payload => { called = payload; return plan({ status: 'rejected' }) } })
  ui.panel.showProposal(plan()); ui.reject.dispatchEvent(new ui.window.Event('click')); await flush()
  assert.deepEqual(called, { id: plan().id, decision: 'reject' })
  assert.equal(ui.approve.disabled, true); assert.equal(ui.reject.disabled, true)
  assert.equal(ui.status.textContent, messages.en.rejected)
  ui.panel.destroy()
})

test('expiry disables approval without sending a decision', () => {
  let calls = 0, now = 1000000
  const ui = setup({ clock: () => now, onDecision: () => { calls++; return Promise.resolve(plan()) } })
  ui.panel.showProposal(plan()); now = 1300000; ui.panel.refresh()
  ui.approve.dispatchEvent(new ui.window.Event('click'))
  assert.equal(calls, 0); assert.equal(ui.approve.disabled, true)
  assert.equal(ui.status.textContent, messages.en.expired)
  ui.panel.destroy()
})

test('late response for replaced proposal cannot change the new proposal', async () => {
  let complete
  const ui = setup({ onDecision: () => new Promise(done => { complete = done }) })
  ui.panel.showProposal(plan()); ui.approve.dispatchEvent(new ui.window.Event('click'))
  const next = plan({ id: 'new-proposal-123456789012', digest: 'b'.repeat(64), spec: { ...spec, memory_mb: 4096 } })
  ui.panel.showProposal(next); complete(plan({ status: 'approved_dry_run' })); await flush()
  assert.equal(ui.status.textContent, messages.en.pending)
  assert.ok(ui.document.body.textContent.includes('4096')); assert.equal(ui.approve.disabled, false)
  ui.panel.destroy()
})

test('new user request removes the previous approval buttons from view', () => {
  const ui = setup(); ui.panel.showProposal(plan()); ui.panel.appendUserText('Use more RAM')
  assert.equal(ui.document.querySelector('.xoa-assistant__proposal').hidden, true)
  assert.equal(ui.approve.disabled, true); ui.panel.destroy()
})

test('malformed, incomplete or hidden extra fields cannot be approved', () => {
  const ui = setup()
  for (const proposal of [plan({ created: true }), plan({ live_execution_available: true }), plan({ mode: 'live' }),
                         plan({ spec: { ...spec, host: '' } }), plan({ spec: { ...spec, secret_field: 'hidden' } })]) {
    assert.equal(ui.panel.showProposal(proposal), false); assert.equal(ui.approve.disabled, true)
  }
  ui.panel.destroy()
})

test('decision response cannot silently change the approved spec', async () => {
  const ui = setup({ onDecision: async () => plan({ status: 'approved_dry_run', spec: { ...spec, memory_mb: 4096 } }) })
  ui.panel.showProposal(plan()); ui.approve.dispatchEvent(new ui.window.Event('click')); await flush()
  assert.equal(ui.status.textContent, messages.en.error)
  assert.ok(ui.document.body.textContent.includes('2048'))
  ui.panel.destroy()
})

test('connection failure never becomes a successful approval', async () => {
  const ui = setup({ onDecision: async () => { throw new Error('private backend details') } })
  ui.panel.showProposal(plan()); ui.approve.dispatchEvent(new ui.window.Event('click')); await flush()
  assert.equal(ui.status.textContent, messages.en.error)
  assert.ok(!ui.document.body.textContent.includes('private backend'))
  ui.panel.destroy()
})

test('locale dictionaries stay complete', () => {
  for (const locale of ['fr', 'ja']) assert.deepEqual(Object.keys(messages[locale]).sort(), Object.keys(messages.en).sort())
})
