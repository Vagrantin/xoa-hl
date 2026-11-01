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
let code = readFileSync(join(source, 'packages/xo-web/src/xo-app/containers/index.js'), 'utf8')
code = code.replace(/^import .+\n/gm, '').replace('export default class Containers', 'class Containers') + '\nmodule.exports = Containers\n'
code = babel.transformSync(code, { configFile: false, babelrc: false, plugins: [
  [deps.resolve('@babel/plugin-proposal-decorators'), { legacy: true }],
  deps.resolve('@babel/plugin-transform-class-properties'), deps.resolve('@babel/plugin-transform-react-jsx'),
] }).code
const calls = []
let pending, cancelled = false, timerId = 0
const timers = new Set()
const context = { module: { exports: {} }, React, Component: React.Component,
  _: key => key, connectStore: () => component => component, Link: props => React.createElement('a', props),
  confirm: () => cancelled ? Promise.reject(new Error('cancel')) : Promise.resolve(),
  containerCall: (op, params) => { calls.push([op, params]); return pending || Promise.resolve({ success: true }) },
  setTimeout: () => { const id = ++timerId; timers.add(id); return id }, clearTimeout: id => timers.delete(id),
}
vm.runInNewContext(code, context)
const Containers = context.module.exports
const props = { admin: true, templates: [], hosts: [], srs: [], networks: [] }
async function tests() {
  const view = renderer.create(React.createElement(Containers, props))
  const page = view.getInstance()
  assert.equal(timers.size, 1)
  assert.ok(JSON.stringify(view.toJSON()).includes('containersTemplateHelp'))
  page.setState({ vm: 'vm-1', name: 'nginx', image: 'nginx:alpine', cpus: '1.5', memoryMiB: '128', ports: '8080:80/tcp', volumes: 'data:/data', environment: 'KEY=value=more' })
  page._create({ preventDefault() {} })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls[0][0], 'create')
  assert.equal(calls[0][1].config.cpus, 1.5)
  assert.equal(calls[0][1].config.environment.KEY, 'value=more')
  assert.equal(calls[0][1].config.ports[0].host, 8080)
  const count = calls.length
  page.setState({ ports: 'not-a-port' }); page._create({ preventDefault() {} })
  assert.equal(calls.length, count)
  assert.ok(page.state.error)
  cancelled = true
  await page._remove('remove', { vm: 'vm-1', id: 'a'.repeat(64) })
  assert.equal(calls.length, count)
  // Poll does not overlap mutations, and unmount clears its only timer.
  let complete
  pending = new Promise(resolve => { complete = resolve })
  const first = page._perform('stop', { vm: 'vm-1', id: 'a'.repeat(64) })
  await page._refresh()
  assert.equal(calls.length, count + 1)
  complete({ success: true }); await first
  view.unmount(); assert.equal(timers.size, 0)
  const denied = renderer.create(React.createElement(Containers, { ...props, admin: false }))
  assert.ok(JSON.stringify(denied.toJSON()).includes('containersAdminOnly'))
  denied.unmount()
  // XSS is rendered as text in log output, even when remote applications control it.
  const logs = renderer.create(React.createElement(Containers, props))
  logs.getInstance().setState({ logs: '<script>alert(1)</script>' })
  const tree = logs.toJSON()
  function nodes(value) { return value ? [value, ...(value.children || []).flatMap(v => typeof v === 'object' ? nodes(v) : [])] : [] }
  assert.equal(nodes(tree).filter(n => n.type === 'script').length, 0)
  assert.ok(JSON.stringify(tree).includes('<script>alert(1)</script>'))
  logs.unmount()
  console.log('Container UI tests passed: forms, cancellation, serialization, unmount, admin gate, escaped logs')
}
tests().catch(error => { console.error(error); process.exitCode = 1 })
