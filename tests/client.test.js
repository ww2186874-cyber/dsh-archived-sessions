import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { renderClientBundle } from '../scripts/build-client.js'

const source = await readFile(new URL('../src/client-module.js', import.meta.url), 'utf8')
const built = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

function evaluateSource(react = {}, globals = {}) {
  const clientExports = {}
  vm.runInNewContext(source, {
    require(specifier) {
      if (specifier !== 'react') throw new Error(`unexpected require: ${specifier}`)
      return react
    },
    exports: clientExports,
    ...globals,
  })
  return clientExports
}

function evaluateBundle() {
  let factory
  vm.runInNewContext(built, {
    window: { __ModuleLoader__: { load(definition) { factory = definition.factory } } },
  })
  return factory((specifier) => {
    if (specifier !== 'react') throw new Error(`unexpected require: ${specifier}`)
    return {}
  })
}

const client = evaluateSource()

test('generated client bundle exactly matches source', () => {
  assert.equal(built, renderClientBundle(source))
  assert.equal(built.includes('\r'), false)
  assert.equal(typeof evaluateBundle().normalizeArchiveData, 'function')
})

test('page store emits only on real transitions and restores opener focus', () => {
  const store = client.createPageStore()
  let changes = 0
  let focusCalls = 0
  const opener = { isConnected: true, focus() { focusCalls += 1 } }
  const dispose = store.subscribe(() => { changes += 1 })
  assert.equal(store.getSnapshot(), false)
  store.close()
  store.open(opener)
  store.open(opener)
  assert.equal(store.getSnapshot(), true)
  store.close()
  assert.equal(store.getSnapshot(), false)
  assert.equal(changes, 2)
  assert.equal(focusCalls, 1)
  dispose()
})

test('settings page stays minimal and its manager button uses theme-aware contrast', () => {
  for (const removed of [
    '集中查看和恢复被归档的会话',
    '管理页面使用 DSH 的公开 Slot',
    '兼容策略',
    '当前有 ${archivedCount} 个已归档会话',
  ]) assert.equal(source.includes(removed), false)
  assert.equal(source.includes("className: 'dsh-archive-settings__open'"), true)
  assert.match(source, /\.dsh-archive-settings__open\{[^}]*background:var\(--dsw-alias-brand-primary\);color:var\(--dsw-alias-bg-base\)/)
})

test('archive data decoder owns only expected scalar fields', () => {
  const decoded = client.normalizeArchiveData({
    archivedCount: 1,
    capability: { canRestore: true, mode: 'native', message: 'ok', ignored: { live: true } },
    sessions: [{
      id: 's1', title: 'Session', cwd: 'C:/work', createdAt: 12,
      agentPreset: 'code', workspaceId: 'w1', workspaceTitle: 'Work', available: true,
      ignored: { service: 'must not escape' },
    }],
  })
  assert.deepEqual(JSON.parse(JSON.stringify(decoded)), {
    archivedCount: 1,
    capability: { canRestore: true, mode: 'native', message: 'ok' },
    sessions: [{
      id: 's1', title: 'Session', cwd: 'C:/work', createdAt: 12,
      agentPreset: 'code', workspaceId: 'w1', workspaceTitle: 'Work', available: true,
    }],
  })
})

test('list request uses same-origin no-store GET', async () => {
  let captured
  const data = await client.fetchArchiveList(async (url, init) => {
    captured = { url, init }
    return { ok: true, status: 200, json: async () => ({ ok: true, data: { sessions: [], archivedCount: 0, capability: {} } }) }
  })
  assert.equal(captured.url, '/archived-sessions/api/list')
  assert.equal(captured.init.method, 'GET')
  assert.equal(captured.init.credentials, 'same-origin')
  assert.equal(captured.init.cache, 'no-store')
  assert.deepEqual(data.sessions, [])
})

test('persistent client apply lifecycle-owns styles and registers only additive public Slots', () => {
  const registrations = []
  const effects = []
  const tags = []
  const document = {
    head: { appendChild(tag) { tags.push(tag) } },
    createElement(name) {
      assert.equal(name, 'style')
      return { dataset: {}, remove() { this.removed = true } }
    },
  }
  const module = evaluateSource({}, { document })
  const ctx = {
    effect(callback, label) {
      effects.push({ label, dispose: callback() })
    },
    slots: {
      inject(key, callback) {
        assert.ok(['settings.section', 'shell.overlay'].includes(key))
        callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  module.apply(ctx)
  assert.deepEqual(registrations.map(({ options }) => [options.name, options.id]), [
    ['settings.section', 'archived-sessions'],
    ['shell.overlay', 'archived-sessions-page'],
  ])
  assert.equal(source.includes('sidebar.footer.action'), false)
  assert.equal(tags.length, 1)
  assert.equal(tags[0].dataset.plugin, 'dsh-archived-sessions')
  assert.equal(tags[0].textContent.includes('.dsh-archive-page'), true)
  assert.deepEqual(effects.map((entry) => entry.label), [
    'archived-sessions: page state',
    'archived-sessions: styles',
  ])
  for (const effect of effects.reverse()) effect.dispose()
  assert.equal(tags[0].removed, true)
})

test('restore request sends one session id as same-origin JSON', async () => {
  let captured
  const result = await client.restoreArchiveSession(async (url, init) => {
    captured = { url, init }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        restored: true,
        data: { sessions: [], archivedCount: 0, capability: { canRestore: true, mode: 'compatibility', message: 'ok' } },
      }),
    }
  }, 's1')
  assert.equal(captured.url, '/archived-sessions/api/restore')
  assert.equal(captured.init.method, 'POST')
  assert.equal(captured.init.credentials, 'same-origin')
  assert.equal(captured.init.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(captured.init.body), { sessionId: 's1' })
  assert.equal(result.restored, true)
})
