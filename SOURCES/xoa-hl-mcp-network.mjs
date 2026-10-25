// Scoped to audited @xen-orchestra/mcp 1.1.0, whose XO client uses global fetch.
// This is not a sandbox for an arbitrary or modified Node package.
const expected = new URL(process.env.XO_URL)
if (!['http:', 'https:'].includes(expected.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(expected.hostname) || expected.username || expected.password || expected.search || expected.hash || expected.pathname !== '/') {
  throw new Error('XO endpoint must be a loopback origin')
}
const paths = new Set(['/rest/v0/pools', '/rest/v0/hosts', '/rest/v0/vms', '/rest/v0/srs', '/rest/v0/networks'])
const nativeFetch = globalThis.fetch
Object.defineProperty(globalThis, 'fetch', {
  configurable: false, writable: false,
  value: async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const method = String(init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (url.origin !== expected.origin || !paths.has(url.pathname) || method !== 'GET' || url.username || url.password || url.hash) {
      throw new Error('Request outside the reviewed read-only XO surface')
    }
    return nativeFetch(input, { ...init, redirect: 'error' })
  },
})
