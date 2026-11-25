// Exercises the module added by 290-no-default-admin.patch (xcp-hl#388, xcp-hl#389).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const patch = fs.readFileSync(new URL('../patches/290-no-default-admin.patch', import.meta.url), 'utf8')
const added = patch.split('diff --git ').find(part => part.includes('b/packages/xo-server/src/_xoaHlAccounts.mjs'))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoa-hl-'))
const file = path.join(dir, 'accounts.mjs')
fs.writeFileSync(file, added.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1)).join('\n'))
const m = await import(file)
test.after(() => fs.rmSync(dir, { recursive: true }))

const missing = () => Promise.reject(Object.assign(Error('missing'), { code: 'ENOENT' }))
const b64 = v => Buffer.from(v).toString('base64')
const none = async () => undefined
const choose = o => m.chooseFirstAccount({ fromXenStore: none, fromDeployment: none, onImage: async () => true, ...o })

test('the deployment envelope gives the first account, special characters included', async () => {
  const read = async () => `XOA_EMAIL=${b64('a@b.test')}\nXOA_PASSWORD=${b64('p=$()`é')}\nSSH_PASSWORD=${b64('x')}\n`
  assert.deepEqual(await m.readDeploymentAccount(read), { email: 'a@b.test', password: 'p=$()`é' })
})
test('a missing or incomplete envelope gives nothing, other errors are not hidden', async () => {
  assert.equal(await m.readDeploymentAccount(missing), undefined)
  assert.equal(await m.readDeploymentAccount(async () => `XOA_EMAIL=${b64('a@b.test')}\nXOA_PASSWORD=\n`), undefined)
  await assert.rejects(m.readDeploymentAccount(() => Promise.reject(Object.assign(Error('no'), { code: 'EACCES' }))))
})
test('an image never creates the default account', async () => {
  assert.equal(await choose({}), undefined)
  for (const partial of [{}, { email: 'a@b.test' }, { password: 'p' }]) assert.equal(await choose({ fromXenStore: async () => partial }), undefined)
  assert.deepEqual(await choose({ fromDeployment: async () => ({ email: 'a@b.test', password: 'p' }) }), { email: 'a@b.test', password: 'p' })
  assert.deepEqual(await choose({ fromXenStore: async () => ({ email: 'x@b.test', password: 'q' }) }), { email: 'x@b.test', password: 'q' })
})
test('outside the image the upstream default is unchanged', async () => {
  const onImage = async () => false
  assert.deepEqual(await choose({ onImage }), m.DEFAULT_ADMIN)
  assert.deepEqual(await choose({ onImage, fromXenStore: async () => ({ email: 'a@b.test' }) }), { email: 'a@b.test', password: 'admin' })
})
test('image detection', async () => {
  assert.equal(await m.isXoaHlImage(async () => 'built'), true)
  assert.equal(await m.isXoaHlImage(missing), false)
})
test('only the default admin with the default password is refused on import', async () => {
  const verify = async (password, hash) => hash === `hash:${password}`
  assert.equal(await m.isDefaultAdmin({ email: 'admin@admin.net', pw_hash: 'hash:admin' }, verify), true)
  assert.equal(await m.isDefaultAdmin({ email: 'admin@admin.net', pw_hash: 'hash:strong' }, verify), false)
  assert.equal(await m.isDefaultAdmin({ email: 'owner@b.test', pw_hash: 'hash:admin' }, verify), false)
  assert.equal(await m.isDefaultAdmin({ email: 'admin@admin.net' }, verify), false)
})
test('the server no longer logs the password of the first account', () => {
  assert.match(patch, /^-.*Default user created: \$\{email\} with password/m)
  assert.doesNotMatch(patch, /^\+.*log\..*password \$\{/m)
})
