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
  const file = pathToFileURL(join(source, 'packages/xo-server/src/containers.mjs')).href
  const wrapper = `export * from ${JSON.stringify(file)}; export const isEnabled = async () => globalThis.__dockerSwitch === true`
  code = code.replace("'../containers.mjs'", JSON.stringify('data:text/javascript;base64,' + Buffer.from(wrapper).toString('base64')))
  const api = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  for (const [name, fn] of Object.entries(api)) {
    assert.equal(fn.permission, 'admin', name)
    assert.equal(typeof fn.params, 'object', name)
    if (!['deploy', 'summary', 'forgetCredentials', 'enabled'].includes(name)) assert.deepEqual(fn.resolve.vm, ['vm', 'VM', 'administrate'])
  }
  // Feature switch off: only `enabled` answers, and nothing reaches a guest or XAPI.
  const context = { getObjects: () => { throw new Error('objects read while switched off') } }
  const vm = { power_state: 'Running', tags: ['xcp-hl-docker-v1'] }
  assert.equal(await api.enabled.call(context), false)
  for (const [name, fn] of Object.entries(api)) {
    if (name !== 'enabled') await assert.rejects(fn.call(context, { vm, id: 'host-abc123' }), /not enabled/, name)
  }
  globalThis.__dockerSwitch = true
  assert.equal(await api.enabled.call(context), true)
  await assert.rejects(api.deploy({ template: { tags: [] }, name: 'Docker', cpus: 2, memoryMiB: 2048 }), /template/)
  await assert.rejects(api.deploy({ template: { tags: ['xcp-hl-docker-template-v1'], $pool: 'a' }, sr: { $pool: 'b' }, network: { $pool: 'a' }, name: 'Docker', cpus: 2, memoryMiB: 2048 }), /same pool/)
  delete globalThis.__dockerSwitch
})

test('operations on one guest queue in order, survive a failure and are bounded', async () => {
  const root = await mkdtemp(join(tmpdir(), 'containers-test-'))
  try {
    const keys = await prepareCredentials(root)
    const vm = { power_state: 'Running', tags: ['xcp-hl-docker-v1', keys.tag], addresses: { '0/ipv4/0': '192.0.2.9' } }
    const children = []
    const spawnProcess = () => {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough()
      child.stdin.resume()
      children.push(child)
      return child
    }
    const tick = () => new Promise(resolve => setTimeout(resolve, 20))
    const first = remote(vm, { operation: 'create' }, { root, spawnProcess })
    const second = remote(vm, { operation: 'overview' }, { root, spawnProcess })
    const outcomes = [first, second].map(promise => promise.then(() => 'ok', error => error.message))
    await tick()
    assert.equal(children.length, 1)
    children[0].emit('close', 255)
    assert.match(await outcomes[0], /not ready/)
    await tick()
    assert.equal(children.length, 2)
    children[1].stdout.write('{"result":{"success":true}}'); children[1].emit('close', 0)
    assert.equal(await outcomes[1], 'ok')
    // A stuck guest cannot pile up unbounded work in XO.
    const waiting = Array.from({ length: 8 }, () =>
      remote(vm, { operation: 'overview' }, { root, spawnProcess }).then(() => 'ok', error => error.message))
    await assert.rejects(remote(vm, { operation: 'overview' }, { root, spawnProcess }), /Too many/)
    for (let index = 2; index < 10; index++) { await tick(); children[index].emit('close', 255) }
    for (const message of await Promise.all(waiting)) assert.match(message, /not ready/)
    await rm(join(keys.directory, 'client'))
    await assert.rejects(remote(vm, { operation: 'overview' }, { root, spawnProcess }), /backup/)
    await assert.rejects(remote(vm, { operation: 'overview' }, { root, spawnProcess }), /backup/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('only access keys that no VM, snapshot or template uses can be forgotten', async () => {
  const root = await mkdtemp(join(tmpdir(), 'containers-test-'))
  try {
    const used = await prepareCredentials(root)
    const snapshot = await prepareCredentials(root)
    const orphan = await prepareCredentials(root)
    await writeFile(join(root, 'stray-file'), '')
    const objects = [{ type: 'VM', tags: ['xcp-hl-docker-v1', used.tag] }, { type: 'VM-snapshot', tags: [snapshot.tag] }, { type: 'VM' }]
    const id = orphan.tag.split(':')[1]
    assert.deepEqual(await core.orphanCredentialIds(objects, root), [id])
    for (const bad of [used.tag.split(':')[1], '../' + id, 'stray-file', undefined])
      await assert.rejects(core.forgetCredentials(bad, objects, root), /still used|do not exist/)
    await core.forgetCredentials(id, objects, root)
    await assert.rejects(stat(orphan.directory), { code: 'ENOENT' })
    await stat(used.directory)
    assert.deepEqual(await core.orphanCredentialIds(objects, root), [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('summary lists every Docker VM and never fails because one guest is down', async () => {
  let code = await readFile(join(source, 'packages/xo-server/src/api/containers.mjs'), 'utf8')
  code = code.replace("import { create as createVm } from './vm.mjs'", 'const createVm = () => {}')
  const file = pathToFileURL(join(source, 'packages/xo-server/src/containers.mjs')).href
  const wrapper = `export * from ${JSON.stringify(file)}; export const isEnabled = async () => true; export const orphanCredentialIds = async () => ['host-abc123']; export const remote = async vm => { if (vm.id === 'broken') throw new Error('Docker VM is not ready'); return { host: { cpus: 2, cpusAllocated: 1.5 }, containers: [{ State: 'running' }, { State: 'exited' }], tasks: [{ state: 'failed' }] } }`
  code = code.replace("'../containers.mjs'", JSON.stringify('data:text/javascript;base64,' + Buffer.from(wrapper).toString('base64')))
  const api = await import('data:text/javascript;base64,' + Buffer.from(code + '\n// summary').toString('base64'))
  const tags = ['xcp-hl-docker-v1']
  const address = { addresses: { '0/ipv4/0': '192.0.2.9' } }
  const objects = {
    a: { type: 'VM', id: 'ok', name_label: 'Docker', power_state: 'Running', tags, ...address },
    b: { type: 'VM', id: 'broken', name_label: 'Docker 2', power_state: 'Running', tags, ...address },
    c: { type: 'VM', id: 'off', name_label: 'Docker 3', power_state: 'Halted', tags },
    d: { type: 'VM', id: 'other', power_state: 'Running', tags: [] },
    e: { type: 'VM-template', tags: ['xcp-hl-docker-template-v1'] },
  }
  let reads = 0
  const context = { getObjects: () => { reads++; return objects } }
  const result = await api.summary.call(context)
  assert.deepEqual(result.hosts.map(host => host.id), ['ok', 'broken', 'off'])
  assert.deepEqual([result.hosts[0].containers, result.hosts[0].running, result.hosts[0].failedDownloads, result.hosts[0].cpusAllocated], [2, 1, 1, 1.5])
  assert.equal(result.hosts[0].address, '192.0.2.9')
  assert.match(result.hosts[1].error, /not ready/)
  assert.equal(result.hosts[2].powerState, 'Halted')
  assert.deepEqual([result.templates, result.orphans], [1, ['host-abc123']])
  // Several dashboards within the cache window share one round of guest calls.
  await api.summary.call(context)
  assert.equal(reads, 1)
})

test('deployment reuses XO full-copy creation, carries private seed, and cleans failed credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'containers-deploy-test-'))
  try {
    const file = pathToFileURL(join(source, 'packages/xo-server/src/containers.mjs')).href
    const wrapper = `export * from ${JSON.stringify(file)}; import { prepareCredentials as prepare } from ${JSON.stringify(file)}; export const isEnabled = async () => true; export const prepareCredentials = () => prepare(${JSON.stringify(root)})`
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

test('the feature switch is a file that is absent by default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'containers-switch-test-'))
  try {
    assert.equal(core.SWITCH, '/etc/xoa-hl/containers.enabled')
    assert.equal(await core.isEnabled(join(root, 'containers.enabled')), false)
    await writeFile(join(root, 'containers.enabled'), '')
    assert.equal(await core.isEnabled(join(root, 'containers.enabled')), true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
