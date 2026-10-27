import { messages, language } from './locales.mjs'

const FIELDS = ['name', 'template', 'vcpus', 'memory_mb', 'disk_gb', 'host', 'sr', 'network', 'tags']
const STATUSES = new Set(['pending', 'approved_dry_run', 'rejected', 'expired', 'invalidated', 'superseded'])
function validProposal(value) {
  if (!value || value.mode !== 'propose_only' || value.created !== false || value.live_execution_available !== false ||
      typeof value.id !== 'string' || value.id.length < 16 || !/^[a-f0-9]{64}$/.test(value.digest) ||
      !Number.isFinite(value.expires_at) || !STATUSES.has(value.status) || !value.spec) return false
  if (Object.keys(value.spec).some(key => !FIELDS.includes(key))) return false
  for (const key of FIELDS.filter(k => k !== 'tags')) {
    if (!Object.hasOwn(value.spec, key)) return false
    if (['vcpus', 'memory_mb', 'disk_gb'].includes(key)) {
      if (!Number.isInteger(value.spec[key]) || value.spec[key] <= 0) return false
    } else if (typeof value.spec[key] !== 'string' || !value.spec[key]) return false
  }
  return value.spec.tags === undefined || (Array.isArray(value.spec.tags) && value.spec.tags.every(tag => typeof tag === 'string'))
}

// Transport-independent component. The host supplies an authenticated bridge;
// no network request, model execution or VM operation exists in this module.
export function createAssistantPanel({ document, locale = 'en', enabled = false, onDecision, clock = Date.now, autoRefresh = true } = {}) {
  if (enabled !== true) return { element: null, destroy() {} }
  if (!document || typeof onDecision !== 'function') throw new Error('A document and authenticated decision handler are required')
  const lang = language(locale), text = messages[lang]
  const node = (tag, className, value) => {
    const result = document.createElement(tag)
    if (className) result.className = className
    if (value !== undefined) result.textContent = value
    return result
  }
  const element = node('section', 'xoa-assistant')
  element.lang = lang
  element.setAttribute('aria-label', text.title)
  const header = node('header', 'xoa-assistant__header')
  header.append(node('h2', '', text.title), node('p', '', text.subtitle))
  const log = node('div', 'xoa-assistant__log')
  log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite')
  const card = node('section', 'xoa-assistant__proposal'); card.hidden = true
  card.append(node('h3', '', text.proposal), node('p', 'xoa-assistant__notice', text.proposeOnly))
  const fields = node('dl', 'xoa-assistant__fields')
  const status = node('p', 'xoa-assistant__status'); status.setAttribute('role', 'status')
  const actions = node('div', 'xoa-assistant__actions')
  const approve = node('button', 'xoa-assistant__approve', text.approve)
  const reject = node('button', 'xoa-assistant__reject', text.reject)
  approve.type = reject.type = 'button'
  approve.disabled = reject.disabled = true
  actions.append(approve, reject); card.append(fields, status, actions); element.append(header, log, card)
  let proposal = null, busy = false, generation = 0, destroyed = false, response = null
  const refresh = () => {
    if (destroyed || !proposal) return
    if (proposal.status === 'pending' && clock() >= proposal.expires_at * 1000) proposal.status = 'expired'
    const available = proposal.status === 'pending' && !busy
    approve.disabled = reject.disabled = !available
    if (busy) status.textContent = text.busy
    else status.textContent = text[proposal.status] ?? text.unavailable
  }
  const clearProposal = () => {
    generation++; proposal = null; busy = false
    card.hidden = true; approve.disabled = reject.disabled = true
  }
  const showProposal = value => {
    clearProposal()
    if (!validProposal(value)) {
      card.hidden = false; fields.replaceChildren(); status.textContent = text.unavailable
      return false
    }
    proposal = JSON.parse(JSON.stringify(value))
    card.hidden = false; fields.replaceChildren()
    for (const key of FIELDS) {
      if (key === 'tags' && !proposal.spec.tags?.length) continue
      fields.append(node('dt', '', text[key]), node('dd', '', key === 'tags' ? proposal.spec.tags.join(', ') : String(proposal.spec[key])))
    }
    refresh(); return true
  }
  const decide = async decision => {
    refresh()
    if (destroyed || busy || !proposal || proposal.status !== 'pending') return
    const current = proposal.id, version = generation
    busy = true; refresh()
    try {
      // Identity and specification are intentionally absent. Server state binds
      // this opaque ID to the authenticated user/session and immutable plan.
      const updated = await onDecision(Object.freeze({ id: current, decision }))
      if (destroyed || generation !== version || proposal?.id !== current) return
      if (!validProposal(updated) || updated.id !== current || updated.digest !== proposal.digest ||
          FIELDS.some(key => JSON.stringify(updated.spec[key]) !== JSON.stringify(proposal.spec[key])) || updated.status === 'pending') throw new Error('Invalid decision response')
      proposal = JSON.parse(JSON.stringify(updated)); busy = false; refresh()
    } catch {
      if (destroyed || generation !== version || proposal?.id !== current) return
      busy = false; refresh()
      if (proposal.status === 'pending') status.textContent = text.error
    }
  }
  approve.addEventListener('click', () => decide('approve'))
  reject.addEventListener('click', () => decide('reject'))
  const timer = autoRefresh ? setInterval(refresh, 1000) : null
  timer?.unref?.()
  return {
    element, showProposal, clearProposal, refresh,
    appendAssistantText(chunk) {
      if (destroyed) return
      if (!response) { response = node('p', 'xoa-assistant__message'); log.append(response) }
      response.append(document.createTextNode(String(chunk)))
    },
    appendUserText(message) {
      if (destroyed) return
      response = null; clearProposal(); log.append(node('p', 'xoa-assistant__message xoa-assistant__message--user', String(message)))
    },
    destroy() {
      destroyed = true; generation++
      if (timer !== null) clearInterval(timer)
      element.remove()
    },
  }
}
