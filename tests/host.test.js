import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createArchiveManager,
  createListHandler,
  createRestoreHandler,
  inspectRestoreCapability,
} from '../lib/index.js'

const allowCompatibility = () => true

function headerOf(sessionId) {
  if (sessionId === 's-new') {
    return { id: sessionId, createdAt: 20, cwd: 'C:\\work\\new', agentPreset: 'code' }
  }
  return { id: sessionId, createdAt: 10, cwd: 'C:\\work\\old' }
}

function makeRegistry(ids = ['s-old', 's-new']) {
  const registry = {
    archivedSessionIds: [...ids],
    state: {
      initialized: true,
      workspaceIds: ['w1'],
      archivedSessionIds: [...ids],
    },
    writes: 0,
    list() {
      return [{ id: 'w1', title: 'Studio', sessionIds: ['s-new', 's-old'] }]
    },
    enqueueOperation(operation) { return Promise.resolve().then(operation) },
    async setState(next) {
      registry.writes += 1
      registry.state = next
      registry.archivedSessionIds = [...next.archivedSessionIds]
    },
  }
  return registry
}

function makeQuery() {
  return {
    async readTitleSnapshots(ids) {
      return ids.map((sessionId) => sessionId === 's-new'
        ? { sessionId, status: 'fulfilled', value: { session: headerOf(sessionId), title: { title: 'Newest session' } } }
        : { sessionId, status: 'fulfilled', value: { session: headerOf(sessionId) } })
    },
  }
}

function managerFor(registry = makeRegistry()) {
  return createArchiveManager({
    workspaceRegistry: registry,
    sessionQuery: makeQuery(),
    compatibilityCheck: allowCompatibility,
  })
}

test('capability probe prefers a future native unarchive method', () => {
  const registry = makeRegistry()
  registry.unarchiveSession = async () => {}
  assert.deepEqual(inspectRestoreCapability(registry), {
    canRestore: true,
    mode: 'native',
    message: '当前 DSH 提供官方会话恢复接口；插件会在操作后核对归档集合。',
  })
})

test('private compatibility mode requires the exact injected fingerprint gate', () => {
  const registry = makeRegistry()
  assert.equal(inspectRestoreCapability(registry).mode, 'unsupported', 'ordinary shape-only mocks must fail closed')
  assert.deepEqual(inspectRestoreCapability(registry, allowCompatibility), {
    canRestore: true,
    mode: 'compatibility',
    message: '已匹配 DSH 0.1.1-rc.2 的精确实现指纹；恢复操作将与工作区写入串行执行。',
  })
})

test('duplicate archive ids are treated as malformed and never enabled', async () => {
  const registry = makeRegistry(['s-new', 's-new'])
  const capability = inspectRestoreCapability(registry, allowCompatibility)
  assert.equal(capability.canRestore, false)
  await assert.rejects(managerFor(registry).list(), (error) => error.code === 'archive-state-unavailable')
  assert.equal(registry.writes, 0)
})

test('archive manager reads only requested archived observations and returns owned scalar fields', async () => {
  const registry = makeRegistry()
  const requested = []
  const query = makeQuery()
  const original = query.readTitleSnapshots
  query.readTitleSnapshots = async (ids) => {
    requested.push([...ids])
    return original(ids)
  }
  const manager = createArchiveManager({ workspaceRegistry: registry, sessionQuery: query, compatibilityCheck: allowCompatibility })
  const result = await manager.list()
  assert.deepEqual(requested, [['s-old', 's-new']])
  assert.equal(result.archivedCount, 2)
  assert.equal(result.capability.mode, 'compatibility')
  assert.deepEqual(result.sessions.map((session) => session.id), ['s-new', 's-old'])
  assert.deepEqual(result.sessions[0], {
    id: 's-new',
    title: 'Newest session',
    cwd: 'C:\\work\\new',
    createdAt: 20,
    agentPreset: 'code',
    workspaceId: 'w1',
    workspaceTitle: 'Studio',
    available: true,
  })
  assert.equal(result.sessions[1].title, 'old')
})

test('compatibility restore serializes and preserves every unrelated state field', async () => {
  const registry = makeRegistry()
  registry.state.pendingMutation = { operation: 'create', workspaceId: 'pending' }
  const result = await managerFor(registry).restore('s-new')
  assert.equal(result.restored, true)
  assert.equal(registry.writes, 1)
  assert.deepEqual(registry.archivedSessionIds, ['s-old'])
  assert.deepEqual(registry.state, {
    initialized: true,
    workspaceIds: ['w1'],
    archivedSessionIds: ['s-old'],
    pendingMutation: { operation: 'create', workspaceId: 'pending' },
  })
  assert.deepEqual(result.data.sessions.map((session) => session.id), ['s-old'])
})

test('compatibility restore rejects a projection conflict without writing', async () => {
  const registry = makeRegistry()
  registry.state.archivedSessionIds = ['s-new', 's-old']
  await assert.rejects(managerFor(registry).restore('s-new'), (error) => error.code === 'restore-state-conflict')
  assert.equal(registry.writes, 0)
})

test('compatibility seam is checked again inside the queued operation', async () => {
  const registry = makeRegistry()
  let probes = 0
  const manager = createArchiveManager({
    workspaceRegistry: registry,
    sessionQuery: makeQuery(),
    compatibilityCheck() { probes += 1; return probes < 3 },
  })
  await assert.rejects(manager.restore('s-new'), (error) => error.code === 'restore-adapter-unavailable')
  assert.equal(registry.writes, 0)
})

test('native restore is verified against the authoritative archive set', async () => {
  const registry = makeRegistry(['s-new'])
  const calls = []
  registry.unarchiveSession = async (sessionId) => {
    calls.push(sessionId)
    registry.archivedSessionIds = []
    registry.state = { ...registry.state, archivedSessionIds: [] }
  }
  const result = await createArchiveManager({ workspaceRegistry: registry, sessionQuery: makeQuery() }).restore('s-new')
  assert.deepEqual(calls, ['s-new'])
  assert.equal(result.restored, true)
  assert.equal(result.data.archivedCount, 0)
})

test('a future same-named native method cannot claim success without membership change', async () => {
  const registry = makeRegistry(['s-new'])
  registry.unarchiveSession = async () => false
  const manager = createArchiveManager({ workspaceRegistry: registry, sessionQuery: makeQuery() })
  await assert.rejects(manager.restore('s-new'), (error) => error.code === 'restore-not-committed')
})

test('invalid session ids are rejected before any write', async () => {
  const registry = makeRegistry()
  await assert.rejects(managerFor(registry).restore(' bad '), (error) => error.code === 'invalid-session-id')
  assert.equal(registry.writes, 0)
})

function responseRecorder() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers },
    end(body) { this.body = body },
  }
}

function request({
  method = 'POST',
  headers = {},
  remoteAddress = '127.0.0.1',
  body = '',
} = {}) {
  return {
    method,
    headers: {
      host: '127.0.0.1:3080',
      origin: 'http://127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...headers,
    },
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() {
      if (body !== '') yield Buffer.from(body)
    },
  }
}

test('list route rejects non-loopback callers before touching the manager', async () => {
  let called = false
  const handler = createListHandler({ async list() { called = true; return {} } })
  const response = responseRecorder()
  await handler(request({ method: 'GET', remoteAddress: '192.0.2.10' }), response)
  assert.equal(response.statusCode, 403)
  assert.equal(called, false)
  assert.equal(JSON.parse(response.body).error.code, 'remote-access-disabled')
})

test('list route serves loopback same-origin requests without caching', async () => {
  const handler = createListHandler({ async list() { return { sessions: [], archivedCount: 0 } } })
  const response = responseRecorder()
  await handler(request({ method: 'GET' }), response)
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['cache-control'], 'no-store, max-age=0')
  assert.deepEqual(JSON.parse(response.body).data, { sessions: [], archivedCount: 0 })
})

test('restore route requires exact same-origin browser provenance', async () => {
  let called = false
  const handler = createRestoreHandler({ async restore() { called = true; return {} } })
  for (const headers of [
    { origin: undefined },
    { 'sec-fetch-site': undefined },
    { origin: 'http://localhost:3080' },
    { 'sec-fetch-site': 'cross-site' },
  ]) {
    const response = responseRecorder()
    await handler(request({ headers, body: '{"sessionId":"s-new"}' }), response)
    assert.equal(response.statusCode, 403)
  }
  assert.equal(called, false)
})

test('restore route rejects forwarding headers before parsing the body', async () => {
  const handler = createRestoreHandler({ async restore() { throw new Error('must not run') } })
  const response = responseRecorder()
  await handler(request({ headers: { 'x-forwarded-for': '127.0.0.1' }, body: '{"sessionId":"s-new"}' }), response)
  assert.equal(response.statusCode, 403)
  assert.equal(JSON.parse(response.body).error.code, 'remote-access-disabled')
})

test('restore route accepts bounded same-origin JSON and returns no-store result', async () => {
  const calls = []
  const handler = createRestoreHandler({
    async restore(sessionId) {
      calls.push(sessionId)
      return { restored: true, data: { sessions: [], archivedCount: 0, capability: {} } }
    },
  })
  const response = responseRecorder()
  await handler(request({ body: '{"sessionId":"s-new"}' }), response)
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['cache-control'], 'no-store, max-age=0')
  assert.deepEqual(calls, ['s-new'])
  assert.equal(JSON.parse(response.body).restored, true)
})

test('restore route rejects method, content type, malformed JSON, and oversized body', async () => {
  const handler = createRestoreHandler({ async restore() { throw new Error('must not run') } })
  const cases = [
    [request({ method: 'GET' }), 405],
    [request({ headers: { 'content-type': 'text/plain' }, body: '{}' }), 400],
    [request({ body: '{broken' }), 400],
    [request({ headers: { 'content-length': '9000' }, body: '{}' }), 413],
  ]
  for (const [input, expected] of cases) {
    const response = responseRecorder()
    await handler(input, response)
    assert.equal(response.statusCode, expected)
  }
})

test('unexpected restore errors are redacted from the browser response', async () => {
  const handler = createRestoreHandler({ async restore() { throw new Error('SECRET_INTERNAL_DETAIL') } })
  const response = responseRecorder()
  await handler(request({ body: '{"sessionId":"s-new"}' }), response)
  assert.equal(response.statusCode, 500)
  assert.equal(response.body.includes('SECRET_INTERNAL_DETAIL'), false)
  assert.equal(JSON.parse(response.body).error.code, 'internal-error')
})
