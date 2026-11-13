const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve, join } = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const deps = createRequire(join(resolve(process.env.CONTAINER_TEST_DEPS || '.'), 'package.json'))
const babel = deps('@babel/core')
const React = deps('react')
const renderer = deps('react-test-renderer')
const source = resolve(process.argv[2])
const calls = []
let pending, cancelled = false, timerId = 0, confirmed
const timers = new Set()
const box = type => props => React.createElement(type, null, props.children)
// Load one page module with XO's shared components replaced by plain elements.
function load(file, name) {
  let code = readFileSync(join(source, 'packages/xo-web/src/xo-app/containers', file), 'utf8')
  code = code.replace(/^import [^\n]+\n/gm, '').replace('export default class ' + name, 'class ' + name) + '\nmodule.exports = ' + name + '\n'
  code = babel.transformSync(code, { configFile: false, babelrc: false, plugins: [
    [deps.resolve('@babel/plugin-proposal-decorators'), { legacy: true }],
    deps.resolve('@babel/plugin-transform-class-properties'), deps.resolve('@babel/plugin-transform-react-jsx'),
  ] }).code
  const context = { module: { exports: {} }, React, Component: React.Component,
    _: key => key, connectStore: () => component => component, Link: props => React.createElement('a', props),
    Card: box('section'), CardBlock: box('div'), CardHeader: box('header'), Container: box('main'), Row: box('div'), Col: box('div'),
    Icon: props => React.createElement('i', { className: props.icon }),
    confirm: options => { confirmed = options; return cancelled ? Promise.reject(new Error('cancel')) : Promise.resolve() },
    containerCall: (op, params) => { calls.push([op, params]); return pending || Promise.resolve({ success: true }) },
    setTimeout: () => { const id = ++timerId; timers.add(id); return id }, clearTimeout: id => timers.delete(id),
  }
  vm.runInNewContext(code, context)
  return context.module.exports
}
const Containers = load('index.js', 'Containers')
const DockerCard = load('dashboard-card.js', 'DockerCard')
const settle = () => new Promise(resolve => setImmediate(resolve))
const text = view => JSON.stringify(view.toJSON())
// React 15's test renderer has no query API: walk the rendered tree.
const all = (node, type) => !node || typeof node !== 'object' ? [] :
  [...(node.type === type ? [node] : []), ...(node.children || []).flatMap(child => all(child, type))]
const props = { admin: true, templates: [], hosts: [], srs: [], networks: [], pools: [] }
const MIB = 1048576
const overview = { address: '192.0.2.9', containers: [
    { ID: 'a'.repeat(64), Names: 'web', Image: 'nginx:alpine', State: 'running', Status: 'Up 2 hours', Ports: '8080->80/tcp' },
    { ID: 'b'.repeat(64), Names: 'old', Image: 'busybox', State: 'exited', Status: 'Exited (0)', Ports: '' }],
  limits: { ['a'.repeat(64)]: { cpus: 1.5, memoryMiB: 256 }, ['b'.repeat(64)]: { cpus: 1, memoryMiB: 64 } },
  stats: [{ ID: 'a'.repeat(64), CPUPerc: '3.10%', MemUsage: '20MiB / 256MiB' }], images: [],
  tasks: [{ id: 'c'.repeat(16), kind: 'create', image: 'redis:7', name: 'cache', state: 'failed', error: 'Image download failed' }],
  host: { cpus: 2, cpuTicks: [1, 0, 0, 1, 0, 0, 0, 0], memoryTotal: 2048 * MIB, memoryUsed: 512 * MIB, diskTotal: 100 * MIB, diskUsed: 10 * MIB,
    cpusAllocated: 1.5, memoryAllocatedMiB: 256, dockerVersion: '27' } }

async function tests() {
  // First run: a guide, no deployment form before a template exists, and no guest call.
  let view = renderer.create(React.createElement(Containers, props))
  let page = view.getInstance()
  await settle()
  assert.equal(timers.size, 1)
  assert.ok(text(view).includes('containersGetStarted') && text(view).includes('containersTemplateHelp'))
  assert.ok(!text(view).includes('containersDeploymentHelp'))
  assert.deepEqual(calls.map(call => call[0]), ['summary'])
  view.unmount()

  // One template, pool default storage and one network: deployment needs only a name and a size.
  const lab = { ...props, templates: [{ id: 't', $pool: 'p', name_label: 'Docker host' }], pools: [{ id: 'p', default_SR: 's2' }],
    srs: [{ id: 's1', $pool: 'p' }, { id: 's2', $pool: 'p' }, { id: 's3', $pool: 'other' }], networks: [{ id: 'n', $pool: 'p' }, { id: 'n2', $pool: 'other' }] }
  calls.length = 0
  view = renderer.create(React.createElement(Containers, lab)); page = view.getInstance()
  await settle()
  pending = Promise.resolve({ id: 'new-vm' })
  page._deploy({ preventDefault() {} }); await settle()
  const deploy = calls.find(call => call[0] === 'deploy')[1]
  assert.deepEqual([deploy.template, deploy.sr, deploy.network, deploy.cpus, deploy.memoryMiB], ['t', 's2', 'n', 2, 2048])
  assert.equal(page.state.vm, 'new-vm')
  view.unmount()

  // A single Docker VM is selected without asking, and its state is loaded at once.
  calls.length = 0
  pending = Promise.resolve(overview)
  view = renderer.create(React.createElement(Containers, { ...lab, hosts: [{ id: 'vm-1', name_label: 'Docker' }] })); page = view.getInstance()
  await settle()
  assert.equal(calls.find(call => call[0] === 'overview')[1].vm, 'vm-1')
  const shown = text(view)
  for (const expected of ['3.10%', '1.5', '20MiB / 256MiB', '64', 'containersDownloadFailed', 'redis:7', 'containersReserved', '192.0.2.9'])
    assert.ok(shown.includes(expected), expected)
  assert.ok(!shown.includes('containersGetStarted'))
  // Only actions that apply to the container state are offered.
  const rows = all(view.toJSON(), 'tr').filter(row => all(row, 'button').length > 0)
  const labels = row => all(row, 'button').map(button => button.children.join(''))
  assert.deepEqual(labels(rows[0]), ['containersStop', 'containersRestart', 'containersLogs'])
  assert.deepEqual(labels(rows[1]), ['containersStart', 'containersLogs', 'containersRemove'])

  pending = undefined
  calls.length = 0
  page.setState({ name: 'nginx', image: ' nginx:alpine ', cpus: '1.5', memoryMiB: '128', ports: '8080:80/tcp', volumes: 'data:/data', environment: 'KEY=value=more' })
  pending = Promise.resolve({ task: 'd'.repeat(16) })
  page._create({ preventDefault() {} })
  await settle()
  assert.equal(calls[0][0], 'create')
  assert.equal(calls[0][1].vm, 'vm-1')
  assert.equal(calls[0][1].config.image, 'nginx:alpine')
  assert.equal(calls[0][1].config.cpus, 1.5)
  assert.equal(calls[0][1].config.environment.KEY, 'value=more')
  assert.equal(calls[0][1].config.ports[0].host, 8080)
  // An image that must be downloaded is announced, and the form is kept for a retry.
  assert.equal(page.state.notice, 'containersDownloading')
  assert.equal(page.state.name, 'nginx')
  pending = undefined
  await settle()
  let count = calls.length
  page.setState({ ports: 'not-a-port' }); page._create({ preventDefault() {} })
  assert.equal(calls.length, count)
  assert.ok(page.state.error)
  cancelled = true
  await page._remove('remove', { vm: 'vm-1', id: 'a'.repeat(64) })
  assert.equal(calls.length, count)
  cancelled = false
  // Poll does not overlap mutations.
  let complete
  pending = new Promise(resolve => { complete = resolve })
  const first = page._perform('stop', { vm: 'vm-1', id: 'a'.repeat(64) })
  await page._refresh()
  assert.equal(calls.length, count + 1)
  complete({ success: true }); await first
  pending = undefined
  await settle()
  // A background refresh keeps the forms enabled, and a mutation queues behind it.
  count = calls.length
  pending = new Promise(resolve => { complete = resolve })
  const poll = page._refresh()
  assert.equal(page.state.busy, false)
  const queued = page._perform('start', { vm: 'vm-1', id: 'a'.repeat(64) })
  await settle()
  assert.equal(calls.length, count + 1)
  complete(overview)
  pending = Promise.reject(new Error('Docker operation failed'))
  pending.catch(() => {})
  await poll; await queued
  assert.deepEqual(calls.slice(count, count + 2).map(call => call[0]), ['overview', 'start'])
  // An unreachable guest is reported apart from action errors, which survive the next refresh.
  await settle()
  assert.equal(page.state.error, 'Docker operation failed')
  assert.equal(page.state.unreachable, 'Docker operation failed')
  pending = Promise.resolve(overview)
  await page._refresh()
  assert.equal(page.state.unreachable, '')
  assert.equal(page.state.error, 'Docker operation failed')
  // Unused access keys are listed, and removal carries its own irreversible warning.
  page.setState({ orphans: ['host-abc123'] })
  assert.ok(text(view).includes('containersOrphansHelp') && text(view).includes('host-abc123'))
  pending = Promise.resolve({ orphans: [] })
  await page._remove('forgetCredentials', { id: 'host-abc123' }, 'containersOrphansWarning')
  await settle()
  assert.equal(confirmed.body, 'containersOrphansWarning')
  assert.equal(page.state.orphans.length, 0)
  view.unmount(); assert.equal(timers.size, 0)

  const denied = renderer.create(React.createElement(Containers, { ...props, admin: false }))
  assert.ok(text(denied).includes('containersAdminOnly'))
  denied.unmount()
  // XSS is rendered as text in log output, even when remote applications control it.
  pending = Promise.resolve({ orphans: [] })
  const logs = renderer.create(React.createElement(Containers, props))
  logs.getInstance().setState({ logs: '<script>alert(1)</script>' })
  const tree = logs.toJSON()
  function nodes(value) { return value ? [value, ...(value.children || []).flatMap(v => typeof v === 'object' ? nodes(v) : [])] : [] }
  assert.equal(nodes(tree).filter(n => n.type === 'script').length, 0)
  assert.ok(JSON.stringify(tree).includes('<script>alert(1)</script>'))
  logs.unmount()

  // Dashboard card: absent without Docker VMs or when the API fails, never breaks the dashboard.
  pending = Promise.resolve({ hosts: [], templates: 0, orphans: [] })
  let card = renderer.create(React.createElement(DockerCard)); await settle()
  assert.equal(card.toJSON(), null)
  card.unmount()
  pending = Promise.reject(new Error('unauthorized')); pending.catch(() => {})
  card = renderer.create(React.createElement(DockerCard)); await settle()
  assert.equal(card.toJSON(), null)
  card.unmount()
  pending = Promise.resolve({ templates: 1, orphans: [], hosts: [
    { id: 'vm-1', name: 'Docker', powerState: 'Running', containers: 3, running: 2, downloads: 0, failedDownloads: 1, cpus: 2, load: 1,
      cpusAllocated: 3, memoryAllocatedMiB: 512, memoryTotal: 2048 * MIB, memoryUsed: 1900 * MIB, diskTotal: 100 * MIB, diskUsed: 50 * MIB },
    { id: 'vm-2', name: 'Lab', powerState: 'Running', error: 'Docker VM is not ready' },
    { id: 'vm-3', name: 'Spare', powerState: 'Halted' }] })
  card = renderer.create(React.createElement(DockerCard)); await settle()
  const summary = text(card)
  for (const expected of ['containersDashboard', 'Docker VM is not ready', 'containersVmStopped', 'containersDownloadFailed', '1900', '50', 'text-danger', 'text-warning'])
    assert.ok(summary.includes(expected), expected)
  const strong = all(card.toJSON(), 'strong')[0].children.join('')
  assert.equal(strong, '2 / 3')
  const before = timers.size
  card.unmount(); assert.equal(timers.size, before - 1)
  console.log('Container UI tests passed: first run, defaults, limits, downloads, queued mutations, error separation, unused keys, admin gate, escaped logs, dashboard card')
}
tests().catch(error => { console.error(error); process.exitCode = 1 })
