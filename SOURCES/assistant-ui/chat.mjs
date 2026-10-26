import { createAssistantPanel } from './panel.mjs'
import { messages, language } from './locales.mjs'

// A host-supplied bridge owns its authenticated conversation. This controller
// never sends an owner, session, inventory, specification or approval text.
export function createAssistantChat({ document, locale = 'en', enabled = false, bridge, ...options } = {}) {
  if (enabled !== true) return { element: null, destroy() {} }
  if (!bridge || ['send', 'cancel', 'decide'].some(method => typeof bridge[method] !== 'function')) throw new Error('An authenticated conversation bridge is required')
  const lang = language(locale), text = messages[lang]
  let destroyed = false, generation = 0, active = null, blocked = false, cancelling = false, deciding = false
  const panel = createAssistantPanel({ ...options, document, locale: lang, enabled: true, onDecision: async payload => {
    if (active || blocked || cancelling || deciding || destroyed) throw new Error('Conversation unavailable')
    deciding = true; controls()
    try { return await bridge.decide(payload) }
    finally { deciding = false; controls() }
  } })
  const node = (tag, className, value) => {
    const element = document.createElement(tag); element.className = className
    if (value !== undefined) element.textContent = value
    return element
  }
  const form = node('form', 'xoa-assistant__compose')
  const label = node('label', '', text.requestLabel)
  const input = node('textarea', 'xoa-assistant__input')
  input.rows = 3; input.maxLength = 16384; input.placeholder = text.requestPlaceholder
  input.setAttribute('aria-label', text.requestLabel); label.append(input)
  const actions = node('div', 'xoa-assistant__actions')
  const send = node('button', 'xoa-assistant__send', text.send); send.type = 'submit'
  const stop = node('button', 'xoa-assistant__stop', text.stop); stop.type = 'button'
  const status = node('p', 'xoa-assistant__connection-status'); status.setAttribute('role', 'status')
  actions.append(send, stop); form.append(label, actions, status); panel.element.append(form)
  function controls() {
    send.disabled = destroyed || !!active || blocked || cancelling || deciding
    stop.disabled = destroyed || cancelling || deciding || (!active && !blocked)
    input.disabled = destroyed || !!active || blocked || cancelling || deciding
    panel.setDecisionEnabled(!destroyed && !active && !blocked && !cancelling && !deciding)
  }
  async function cancel() {
    if (destroyed || cancelling || deciding) return false
    generation++; active?.controller.abort(); active = null
    cancelling = true; blocked = true; panel.clearProposal(); controls()
    status.textContent = text.cancelling
    try {
      // Local abort alone does not invalidate a server proposal. Do not unlock
      // another turn until the authenticated cancellation is acknowledged.
      await bridge.cancel()
      if (destroyed) return false
      blocked = false; status.textContent = ''; return true
    } catch {
      if (!destroyed) status.textContent = text.cancelFailed
      return false
    } finally { cancelling = false; controls() }
  }
  async function submit(value) {
    if (destroyed || active || blocked || cancelling || deciding) return false
    const request = String(value ?? '').trim()
    if (!request || request.length > 16384) { status.textContent = text.invalidRequest; return false }
    // Also revoke a completed turn's pending proposal before a correction.
    if (!await cancel()) return false
    const version = ++generation, controller = new AbortController()
    active = { controller }; controls(); input.value = ''
    panel.appendUserText(request); status.textContent = text.answering
    let done = false, received = 0
    const onEvent = event => {
      if (destroyed || version !== generation || controller.signal.aborted || done) return
      if (!event || typeof event !== 'object') throw new Error('Invalid event')
      if (event.type === 'text' && typeof event.text === 'string' && event.text.length <= 8192) {
        received += event.text.length
        if (received > 65536) throw new Error('Response limit')
        panel.appendAssistantText(event.text)
      } else if (event.type === 'proposal') {
        if (!panel.showProposal(event.proposal)) throw new Error('Invalid proposal')
      } else if (event.type === 'done') done = true
      else throw new Error('Unsupported event')
    }
    try {
      await bridge.send(Object.freeze({ text: request, locale: lang }), { signal: controller.signal, onEvent })
      if (destroyed || version !== generation || controller.signal.aborted) return false
      if (!done) throw new Error('Truncated response')
      active = null; status.textContent = ''; controls(); return true
    } catch {
      if (destroyed || version !== generation || controller.signal.aborted) return false
      await cancel()
      if (!destroyed && !blocked) status.textContent = text.connectionFailed
      return false
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); void submit(input.value) })
  stop.addEventListener('click', () => { void cancel() })
  controls()
  return {
    element: panel.element, panel, submit, cancel,
    destroy() {
      if (destroyed) return
      destroyed = true; generation++; active?.controller.abort(); active = null
      panel.clearProposal(); controls(); panel.destroy()
      // The host must also bind cleanup to logout/disconnect/disable server-side.
      Promise.resolve().then(() => bridge.cancel()).catch(() => {})
    },
  }
}
