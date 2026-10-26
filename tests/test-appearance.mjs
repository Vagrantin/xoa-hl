import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

const source = resolve(process.argv[2], 'packages/xo-web/src')
const controller = readFileSync(resolve(source, 'common/xoa-hl-appearance/index.js'), 'utf8')
const { normalize, applyAppearance, startAppearance } = await import('data:text/javascript;base64,' + Buffer.from(controller).toString('base64'))
function environment(cache) {
  const attrs = {}, values = new Map(cache ? [['xoa-hl.appearance.v1', cache]] : [])
  const media = { matches: false, addEventListener: (_, fn) => { media.changed = fn }, removeEventListener: () => {} }
  const win = {
    document: { documentElement: { style: {}, setAttribute: (k, v) => { attrs[k] = v } } },
    matchMedia: () => media,
    localStorage: { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) },
  }
  return { win, attrs, media }
}
assert.deepEqual(normalize(), { theme: 'arctic', mode: 'system' })
for (const input of [null, false, 2, 'invalid', { theme: '<script>', mode: 'auto' }]) assert.deepEqual(normalize(input), normalize())
for (const theme of ['arctic', 'graphite', 'alpine', 'horizon']) {
  for (const mode of ['system', 'light', 'dark']) {
    const e = environment()
    applyAppearance({ theme, mode }, e.win)
    assert.equal(e.attrs['data-xhl-theme'], theme)
    assert.equal(e.attrs['data-xhl-scheme'], mode === 'dark' ? 'dark' : 'light')
    assert.equal(e.win.document.documentElement.style.colorScheme, mode === 'dark' ? 'dark' : 'light')
  }
}
// Exercise the actual Pug bootstrap, including blocked/corrupt browser storage.
const pug = readFileSync(resolve(source, 'index.pug'), 'utf8')
const inline = pug.match(/    script\.\n([\s\S]*?)\n\n    link\(/)[1].replace(/^      /gm, '')
for (const cache of [undefined, 'broken', 'null', '{"theme":"horizon","mode":"dark"}', '{"theme":"invalid","mode":"invalid"}']) {
  const e = environment(cache)
  vm.runInNewContext(inline, { window: e.win, document: e.win.document, localStorage: e.win.localStorage })
  const expected = environment(cache)
  let value
  try { value = JSON.parse(cache) } catch (_) {}
  applyAppearance(value, expected.win)
  assert.deepEqual(e.attrs, expected.attrs)
}
const e = environment('broken')
Object.defineProperty(e.win, 'localStorage', { get() { throw new Error('blocked') } })
vm.runInNewContext(inline, { window: e.win, document: e.win.document, get localStorage() { throw new Error('blocked') } })
let state = { user: null }, sync, unsubscribed = false
const stop = startAppearance({ getState: () => state, subscribe: fn => { sync = fn; return () => { unsubscribed = true } } }, e.win)
assert.equal(e.attrs['data-xhl-theme'], 'arctic')
e.media.matches = true; e.media.changed()
assert.equal(e.attrs['data-xhl-scheme'], 'dark')
state = { user: { id: 'a', preferences: { xoaHlAppearance: { theme: 'alpine', mode: 'light' } } } }; sync()
assert.equal(e.attrs['data-xhl-theme'], 'alpine')
e.media.changed(); assert.equal(e.attrs['data-xhl-scheme'], 'light')
state = { user: { id: 'b', preferences: {} } }; sync()
assert.equal(e.attrs['data-xhl-theme'], 'arctic'); assert.equal(e.attrs['data-xhl-scheme'], 'dark')
state = { user: { id: 'b', preferences: { xoaHlAppearance: { theme: 'graphite', mode: 'dark' } } } }; sync()
assert.equal(e.attrs['data-xhl-theme'], 'graphite')
state = { user: null }; sync()
assert.equal(e.attrs['data-xhl-theme'], 'arctic')
stop(); assert.ok(unsubscribed)
console.log('Appearance: 12 combinations, pre-paint parity, corrupt/blocked storage, OS changes, manual override, account switching and logout passed')
