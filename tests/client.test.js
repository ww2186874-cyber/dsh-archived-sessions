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

test('settings page renders the archive manager directly without a secondary entry point', () => {
  for (const removed of [
    '集中查看和恢复被归档的会话',
    '管理页面使用 DSH 的公开 Slot',
    '兼容策略',
    '当前有 ${archivedCount} 个已归档会话',
    '打开归档管理',
    'shell.overlay',
    'ArchivePage',
    'pageStore',
  ]) assert.equal(source.includes(removed), false)
  assert.equal(source.includes('function ArchiveSettingsSection({ useWorkspaces })'), true)
  assert.equal(source.includes("className: 'dsh-archive-list'"), true)
  assert.equal(source.includes("className: 'dsh-archive-settings__refresh'"), true)
  assert.match(source, /\.dsh-archive-settings__refresh,\.dsh-archive-row__restore\{[^}]*background:var\(--dsw-alias-brand-primary\);color:var\(--dsw-alias-bg-base\)/)
})

test('archive request gate serializes list reads and restores with one deferred refresh', () => {
  const gate = client.createArchiveRequestGate()
  const firstLoad = gate.beginLoad()
  assert.notEqual(firstLoad, null)
  assert.equal(gate.beginRestore(), null)
  assert.equal(gate.beginLoad(), null)
  assert.equal(gate.endLoad(firstLoad), true)

  const secondLoad = gate.beginLoad()
  assert.notEqual(secondLoad, null)
  assert.equal(gate.endLoad(secondLoad), false)

  const restore = gate.beginRestore()
  assert.notEqual(restore, null)
  assert.equal(gate.beginRestore(), null)
  assert.equal(gate.beginLoad(), null)
  assert.equal(gate.beginLoad(), null)
  assert.equal(gate.endRestore(restore), true)
})

test('archive request gate ignores stale finalizers after cancel and reacquire', () => {
  const gate = client.createArchiveRequestGate()
  const staleLoad = gate.beginLoad()
  gate.cancel()
  const currentLoad = gate.beginLoad()
  assert.notEqual(currentLoad, null)
  assert.equal(gate.endLoad(staleLoad), false)
  assert.equal(gate.beginRestore(), null)
  assert.equal(gate.endLoad(currentLoad), false)

  const staleRestore = gate.beginRestore()
  gate.cancel()
  const currentRestore = gate.beginRestore()
  assert.notEqual(currentRestore, null)
  assert.equal(gate.endRestore(staleRestore), false)
  assert.equal(gate.beginLoad(), null)
  assert.equal(gate.endRestore(currentRestore), true)
})

test('restore notices only report the authoritative archive-set transition', () => {
  assert.equal(client.restoreNotice({ title: '可用会话', available: true }, true), '“可用会话”已从归档集合移除，请在侧栏确认会话状态。')
  assert.equal(client.restoreNotice({ title: '缺失日志', available: false }, true), '“缺失日志”已从归档集合移除，请在侧栏确认会话状态。')
  assert.equal(client.restoreNotice({ title: '任意', available: true }, false), '该会话已经不在归档集合中。')
})

test('archive rows disable restore while list data is loading', () => {
  const react = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
  }
  const module = evaluateSource(react)
  const common = {
    session: { id: 's1', title: 'Session', cwd: null, createdAt: null, agentPreset: null, workspaceTitle: null, available: true },
    capability: { canRestore: true, message: '' },
    busySessionId: null,
    onRestore() {},
  }
  const loadingRow = module.ArchiveRow({ ...common, listLoading: true })
  const readyRow = module.ArchiveRow({ ...common, listLoading: false })
  assert.equal(loadingRow.children[2].props.disabled, true)
  assert.equal(readyRow.children[2].props.disabled, false)
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

test('persistent client lifecycle-owns styles and registers only the settings page', () => {
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
        assert.equal(key, 'settings.section')
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
  ])
  assert.equal(source.includes('sidebar.footer.action'), false)
  assert.equal(source.includes('shell.overlay'), false)
  assert.equal(tags.length, 1)
  assert.equal(tags[0].dataset.plugin, 'dsh-archived-sessions')
  assert.equal(tags[0].textContent.includes('.dsh-archive-settings'), true)
  assert.deepEqual(effects.map((entry) => entry.label), [
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
