import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

const source = resolve(process.argv[2] ?? '../xo-source')
const core = await import(pathToFileURL(join(source, 'packages/xo-server/src/containers.mjs')))
const { validateDeployment, prepareCredentials, sshArguments, credentialId, guestAddress, remote } = core

test('deployment and identity validation rejects wrong types, NaN and path traversal', () => {
  validateDeployment({ name: 'Docker 1', cpus: 2, memoryMiB: 2048 })
  for (const value of [0, NaN, Infinity, '2', 33]) assert.throws(() => validateDeployment({ name: 'Docker', cpus: value, memoryMiB: 2048 }))
  assert.throws(() => credentialId({ tags: ['xcp-hl-docker-v1', 'xcp-hl-docker-key:../../etc'] }))
  assert.throws(() => credentialId({ tags: [] }))
  assert.equal(guestAddress({ addresses: { '0/ipv4/0': '192.0.2.9' } }), '192.0.2.9')
  assert.throws(() => guestAddress({ addresses: { a: '127.0.0.1' } }))
})

test('real per-VM SSH keys are private, pre-pinned and forced-command only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'containers-test-'))
  try {
    const keys = await prepareCredentials(root)
    assert.equal((await stat(keys.directory)).mode & 0o777, 0o700)
    assert.equal((await stat(join(keys.directory, 'client'))).mode & 0o777, 0o600)
    const config = JSON.parse(keys.cloudConfig.slice('#cloud-config\n'.length))
    assert.match(config.users[0].ssh_authorized_keys[0], /^restrict,command="\/usr\/local\/libexec\/xoa-hl-docker-command" ssh-ed25519 /)
    assert.match(config.ssh_keys.ed25519_private, /OPENSSH PRIVATE KEY/)
    assert.equal(config.ssh_pwauth, false)
    await assert.rejects(readFile(join(keys.directory, 'host')), { code: 'ENOENT' })
    const args = sshArguments(keys.directory, '192.0.2.9')
    assert.ok(args.includes('StrictHostKeyChecking=yes'))
    assert.ok(args.includes('HostKeyAlias=docker-host'))
    assert.ok(args.includes('IdentitiesOnly=yes'))
    assert.equal(args.at(-2), 'root@192.0.2.9')
    assert.throws(() => sshArguments(keys.directory, '-oProxyCommand=bad'))
    const known = await readFile(join(keys.directory, 'known_hosts'), 'utf8')
    assert.equal(known.trim(), 'docker-host ' + config.ssh_keys.ed25519_public)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('remote transport sends JSON on stdin and surfaces unreachable/authentication failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'containers-test-'))
  try {
    const keys = await prepareCredentials(root)
    const vm = { power_state: 'Running', tags: ['xcp-hl-docker-v1', keys.tag], addresses: { '0/ipv4/0': '192.0.2.9' } }
    let input, child, command
    const spawnProcess = (cmd, args) => {
      command = [cmd, ...args]
      child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough()
      let data = ''
      child.stdin.on('data', c => { data += c })
      child.stdin.on('finish', () => { input = JSON.parse(data); child.stdout.write('{"result":{"success":true}}'); child.emit('close', 0) })
      child.kill = () => child.emit('close', 255)
      return child
    }
    assert.deepEqual(await remote(vm, { operation: 'create', config: { environment: { VALUE: '$(touch /tmp/pwn)' } } }, { root, spawnProcess }), { success: true })
    assert.equal(input.version, 1)
    assert.ok(!command.join(' ').includes('touch'))
    const fail = () => {
      const c = new EventEmitter(); c.stdout = new PassThrough(); c.stdin = new PassThrough(); c.stdin.on('finish', () => c.emit('close', 255)); return c
    }
    await assert.rejects(remote(vm, { operation: 'overview' }, { root, spawnProcess: fail }), /not ready|identity/)
    await assert.rejects(remote({ ...vm, power_state: 'Halted' }, {}, { root, spawnProcess }), /not running/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('all API entry points require XO administrator permission and object parameters', async () => {
  // Load the actual API module with a narrow VM creation dependency stub. Core stays real.
  let code = await readFile(join(source, 'packages/xo-server/src/api/containers.mjs'), 'utf8')
  code = code.replace("import { create as createVm } from './vm.mjs'", 'const createVm = () => { throw new Error("not called") }')
  code = code.replace("'../containers.mjs'", JSON.stringify(pathToFileURL(join(source, 'packages/xo-server/src/containers.mjs')).href))
  const api = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  for (const [name, fn] of Object.entries(api)) {
    assert.equal(fn.permission, 'admin', name)
    assert.equal(typeof fn.params, 'object', name)
    if (!['deploy', 'getHosts'].includes(name)) assert.deepEqual(fn.resolve.vm, ['vm', 'VM', 'administrate'])
  }
  await assert.rejects(api.deploy({ template: { tags: [] }, name: 'Docker', cpus: 2, memoryMiB: 2048 }), /template/)
  await assert.rejects(api.deploy({ template: { tags: ['xcp-hl-docker-template-v1'], $pool: 'a' }, sr: { $pool: 'b' }, network: { $pool: 'a' }, name: 'Docker', cpus: 2, memoryMiB: 2048 }), /same pool/)
})

test('per-host serialization covers credential reads and releases after failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'containers-test-'))
  try {
    const keys = await prepareCredentials(root)
    const vm = { power_state: 'Running', tags: ['xcp-hl-docker-v1', keys.tag], addresses: { '0/ipv4/0': '192.0.2.9' } }
    let child
    let ready
    const spawned = new Promise(resolve => { ready = resolve })
    const spawnProcess = () => {
      child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough()
      child.stdin.on('finish', ready)
      return child
    }
    const first = remote(vm, { operation: 'pull', image: 'busybox:1.37' }, { root, spawnProcess })
    await assert.rejects(remote(vm, { operation: 'overview' }, { root, spawnProcess }), /already running/)
    await spawned
    child.emit('close', 255)
    await assert.rejects(first, /not ready/)
    await rm(join(keys.directory, 'client'))
    await assert.rejects(remote(vm, { operation: 'overview' }, { root, spawnProcess }), /backup/)
    // A missing key failure also releases the serialization lock.
    await assert.rejects(remote(vm, { operation: 'overview' }, { root, spawnProcess }), /backup/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('deployment reuses XO full-copy creation, carries private seed, and cleans failed credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'containers-deploy-test-'))
  try {
    const file = pathToFileURL(join(source, 'packages/xo-server/src/containers.mjs')).href
    const wrapper = `export * from ${JSON.stringify(file)}; import { prepareCredentials as prepare } from ${JSON.stringify(file)}; export const prepareCredentials = () => prepare(${JSON.stringify(root)})`
    const wrapped = 'data:text/javascript;base64,' + Buffer.from(wrapper).toString('base64')
    let code = await readFile(join(source, 'packages/xo-server/src/api/containers.mjs'), 'utf8')
    code = code.replace("import { create as createVm } from './vm.mjs'", 'const createVm = function (params) { return globalThis.__dockerCreate(this, params) }')
    code = code.replace("'../containers.mjs'", JSON.stringify(wrapped))
    const api = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
    const xapi = { getObject: () => ({ $VBDs: [{ type: 'Disk', userdevice: '0', $VDI: {} }] }) }
    const context = { getXapi: () => xapi }
    const params = { template: { id: 'template', _xapiId: 'template', tags: ['xcp-hl-docker-template-v1'], $pool: 'pool' },
      sr: { id: 'storage', $pool: 'pool' }, network: { id: 'network', $pool: 'pool' }, name: 'Docker', cpus: 2, memoryMiB: 2048 }
    globalThis.__dockerCreate = (ctx, p) => {
      assert.equal(ctx, context)
      assert.equal(p.clone, false)
      assert.equal(p.existingDisks['0'].$SR, 'storage')
      assert.equal(p.VIFs[0].network, 'network')
      assert.equal(p.CPUs, 2)
      assert.equal(p.memoryMin, 2048 * 1048576)
      assert.equal(p.destroyCloudConfigVdiAfterBoot, true)
      assert.equal(p.bootAfterCreate, true)
      assert.match(p.cloudConfig, /OPENSSH PRIVATE KEY/)
      assert.ok(p.tags.includes('xcp-hl-docker-v1'))
      return 'new-vm'
    }
    assert.deepEqual(await api.deploy.call(context, params), { id: 'new-vm' })
    const before = await core.availableCredentialIds(root)
    assert.equal(before.length, 1)
    globalThis.__dockerCreate = () => { throw new Error('copy failed') }
    await assert.rejects(api.deploy.call(context, params), /copy failed/)
    assert.deepEqual(await core.availableCredentialIds(root), before)
  } finally {
    delete globalThis.__dockerCreate
    await rm(root, { recursive: true, force: true })
  }
})

test('optional guest-maintenance key is validated and isolated from the forced management identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'containers-admin-test-'))
  try {
    for (const value of ['not-a-key', 'ssh-ed25519 AAAA\ncommand="bad"', 'command="bad" ssh-ed25519 AAAA']) {
      await assert.rejects(prepareCredentials(root, value), /public key/)
    }
    const first = await prepareCredentials(root)
    const publicKey = (await readFile(join(first.directory, 'client.pub'), 'utf8')).trim()
    const second = await prepareCredentials(root, publicKey)
    const config = JSON.parse(second.cloudConfig.slice('#cloud-config\n'.length))
    const admin = config.users.find(user => user.name === 'docker-admin')
    assert.deepEqual(admin.ssh_authorized_keys, [publicKey])
    assert.equal(admin.lock_passwd, true)
    assert.match(config.users.find(user => user.name === 'root').ssh_authorized_keys[0], /^restrict,command=/)
    assert.notEqual(admin.ssh_authorized_keys[0], config.users[0].ssh_authorized_keys[0])
  } finally { await rm(root, { recursive: true, force: true }) }
})
