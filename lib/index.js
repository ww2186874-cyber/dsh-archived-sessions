import { createHash } from 'node:crypto'

const LIST_ROUTE_PATH = '/archived-sessions/api/list'
const RESTORE_ROUTE_PATH = '/archived-sessions/api/restore'
const MAX_REQUEST_BYTES = 8_192
const ALPHA2_METHOD_HASHES = Object.freeze({
  archiveSession: 'c775afd7240062d7c1aab7925d210e670f459e5af7f799eca6901e8604e1fd0e',
  setState: '956bf006d1ddd9878222d7f8e2e148341f2d9c67a868cae8f0a568de2958aaee',
  enqueueOperation: '45c135e725dde8c20d6afe0187d522146550bccca7dd2e59d9055a9b87b9d0a7',
  recoverPendingMutation: '99504c2874a9bd6ab85fc822ed86bf08ab291f05edde7fabdc997023b17b4cb4',
})
const ALPHA2_ARCHIVED_IDS_GETTER_HASH = '558d8bf48533ccc3997b2a06522581d2fd58db228a6b5308c716158b38759221'

export const name = 'dsh-archived-sessions'
export const inject = ['workspaceRegistry', 'sessionQuery', 'webServer']

class PublicArchiveError extends Error {
  constructor(code, message, statusCode = 500) {
    super(message)
    this.name = 'PublicArchiveError'
    this.code = code
    this.statusCode = statusCode
  }
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
}

function requireMethod(owner, serviceName, methodName) {
  if (typeof owner?.[methodName] !== 'function') {
    throw new Error(`dsh-archived-sessions requires ${serviceName}.${methodName}()`)
  }
}

function uniqueStringArray(value) {
  return Array.isArray(value)
    && value.every((item) => typeof item === 'string')
    && new Set(value).size === value.length
}

function workspaceState(value) {
  const state = record(value)
  if (state === null) return null
  if (typeof state.initialized !== 'boolean') return null
  if (!uniqueStringArray(state.workspaceIds) || !uniqueStringArray(state.archivedSessionIds)) return null
  if (state.pendingMutation !== undefined) {
    const pending = record(state.pendingMutation)
    if (pending === null
      || (pending.operation !== 'create' && pending.operation !== 'delete')
      || typeof pending.workspaceId !== 'string'
      || Object.keys(pending).some((key) => key !== 'operation' && key !== 'workspaceId')) return null
  }
  return state
}

function archivedIdsOf(registry) {
  let value
  try { value = registry?.archivedSessionIds } catch { return null }
  return uniqueStringArray(value) ? [...value] : null
}

export function compatibilityMethodHashes(prototype) {
  if (typeof prototype !== 'object' || prototype === null) return null
  const result = {}
  for (const name of Object.keys(ALPHA2_METHOD_HASHES)) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name)
    if (typeof descriptor?.value !== 'function' || descriptor.get !== undefined || descriptor.set !== undefined) return null
    result[name] = createHash('sha256').update(Function.prototype.toString.call(descriptor.value)).digest('hex')
  }
  return result
}

export function matchesAlpha2CompatibilityRegistry(registry) {
  const prototype = typeof registry === 'object' && registry !== null ? Object.getPrototypeOf(registry) : null
  const archiveDescriptor = prototype === null ? undefined : Object.getOwnPropertyDescriptor(prototype, 'archivedSessionIds')
  const hashes = compatibilityMethodHashes(prototype)
  const archiveGetterHash = typeof archiveDescriptor?.get === 'function'
    ? createHash('sha256').update(Function.prototype.toString.call(archiveDescriptor.get)).digest('hex')
    : null
  return archiveGetterHash === ALPHA2_ARCHIVED_IDS_GETTER_HASH
    && archiveDescriptor.set === undefined
    && archiveDescriptor.value === undefined
    && hashes !== null
    && Object.entries(ALPHA2_METHOD_HASHES).every(([name, expected]) => hashes[name] === expected)
}

/**
 * A future public method wins. The private fallback is allowed only when the
 * exact DSH 0.1.2-alpha.2 method implementations and the live state shape match.
 */
export function inspectRestoreCapability(registry, compatibilityCheck = matchesAlpha2CompatibilityRegistry) {
  const ids = archivedIdsOf(registry)
  if (ids === null) {
    return {
      canRestore: false,
      mode: 'unsupported',
      message: '当前 DSH 的归档集合缺失、重复或无法识别；为保护数据，恢复功能已禁用。',
    }
  }
  if (typeof registry?.unarchiveSession === 'function') {
    return {
      canRestore: true,
      mode: 'native',
      message: '当前 DSH 提供官方会话恢复接口；插件会在操作后核对归档集合。',
    }
  }
  const state = workspaceState(registry?.state)
  if (state !== null && compatibilityCheck(registry)) {
    return {
      canRestore: true,
      mode: 'compatibility',
      message: '已匹配 DSH 0.1.2-alpha.2 的精确实现指纹；恢复操作将与工作区写入串行执行。',
    }
  }
  return {
    canRestore: false,
    mode: 'unsupported',
    message: '当前 DSH 未提供官方恢复接口，且不匹配已验证的 alpha.2 兼容指纹；恢复已安全禁用。',
  }
}

function normalizeSessionId(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new PublicArchiveError('invalid-session-id', '会话 ID 无效', 400)
  }
  return value
}

async function restoreWithCompatibilityAdapter(registry, sessionId, compatibilityCheck) {
  if (!compatibilityCheck(registry) || typeof registry?.enqueueOperation !== 'function') {
    throw new PublicArchiveError('restore-adapter-unavailable', 'alpha.2 兼容指纹已变化；恢复已安全停止', 409)
  }
  return registry.enqueueOperation(async () => {
    const state = workspaceState(registry.state)
    const visibleIds = archivedIdsOf(registry)
    if (state === null || visibleIds === null || !compatibilityCheck(registry) || typeof registry.setState !== 'function') {
      throw new PublicArchiveError('restore-adapter-unavailable', 'DSH 归档结构或兼容指纹已变化；恢复已安全停止', 409)
    }
    if (state.pendingMutation !== undefined) {
      throw new PublicArchiveError('restore-state-conflict', '工作区仍有未完成的持久化操作，请刷新后重试', 409)
    }
    if (state.archivedSessionIds.length !== visibleIds.length
      || state.archivedSessionIds.some((id, index) => id !== visibleIds[index])) {
      throw new PublicArchiveError('restore-state-conflict', '归档状态正在变化，请刷新后重试', 409)
    }
    if (!state.archivedSessionIds.includes(sessionId)) return false
    const next = {
      ...state,
      archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId),
    }
    await registry.setState(next)
    return true
  })
}

function pathBaseName(path) {
  if (typeof path !== 'string') return ''
  const parts = path.replace(/[\\/]+$/g, '').split(/[\\/]/g)
  return parts[parts.length - 1] || ''
}

function workspaceIndex(registry, archivedSet) {
  const index = new Map()
  for (const workspace of registry.list()) {
    const sessionIds = Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : []
    for (const sessionId of sessionIds) {
      if (!archivedSet.has(sessionId) || index.has(sessionId)) continue
      index.set(sessionId, {
        workspaceId: typeof workspace.id === 'string' ? workspace.id : null,
        workspaceTitle: typeof workspace.title === 'string' ? workspace.title : null,
      })
    }
  }
  return index
}

function observationIndexes(results) {
  const headers = new Map()
  const titles = new Map()
  for (const result of results) {
    if (result?.status !== 'fulfilled' || typeof result.sessionId !== 'string') continue
    const header = result.value?.session
    const title = result.value?.title?.title
    if (typeof header?.id === 'string' && header.id === result.sessionId) headers.set(result.sessionId, header)
    if (typeof title === 'string' && title.trim() !== '') titles.set(result.sessionId, title)
  }
  return { headers, titles }
}

function sessionView(sessionId, header, title, workspace) {
  const cwd = typeof header?.cwd === 'string' ? header.cwd : null
  const fallbackTitle = pathBaseName(cwd) || sessionId
  return {
    id: sessionId,
    title: typeof title === 'string' ? title : fallbackTitle,
    cwd,
    createdAt: Number.isSafeInteger(header?.createdAt) && header.createdAt >= 0 ? header.createdAt : null,
    agentPreset: typeof header?.agentPreset === 'string' ? header.agentPreset : null,
    workspaceId: workspace?.workspaceId ?? null,
    workspaceTitle: workspace?.workspaceTitle ?? null,
    available: header !== undefined,
  }
}

export function createArchiveManager({
  workspaceRegistry,
  sessionQuery,
  compatibilityCheck = matchesAlpha2CompatibilityRegistry,
}) {
  requireMethod(workspaceRegistry, 'workspaceRegistry', 'list')
  requireMethod(sessionQuery, 'sessionQuery', 'readTitleSnapshots')

  async function list() {
    const archivedSessionIds = archivedIdsOf(workspaceRegistry)
    if (archivedSessionIds === null) {
      throw new PublicArchiveError('archive-state-unavailable', '归档集合缺失或包含重复 ID；为保护数据，操作已停止', 409)
    }
    const capability = inspectRestoreCapability(workspaceRegistry, compatibilityCheck)
    if (archivedSessionIds.length === 0) return { sessions: [], archivedCount: 0, capability }

    const archivedSet = new Set(archivedSessionIds)
    const titleResults = await sessionQuery.readTitleSnapshots(archivedSessionIds)
    const { headers, titles } = observationIndexes(titleResults)
    const workspaces = workspaceIndex(workspaceRegistry, archivedSet)
    const sessions = archivedSessionIds
      .map((sessionId) => sessionView(sessionId, headers.get(sessionId), titles.get(sessionId), workspaces.get(sessionId)))
      .sort((left, right) => (right.createdAt ?? -1) - (left.createdAt ?? -1) || left.id.localeCompare(right.id))
    return { sessions, archivedCount: archivedSessionIds.length, capability }
  }

  async function restore(rawSessionId) {
    const sessionId = normalizeSessionId(rawSessionId)
    const capability = inspectRestoreCapability(workspaceRegistry, compatibilityCheck)
    if (!capability.canRestore) {
      throw new PublicArchiveError('restore-unsupported', capability.message, 409)
    }
    const before = archivedIdsOf(workspaceRegistry)
    if (before === null) throw new PublicArchiveError('archive-state-unavailable', '归档集合缺失或包含重复 ID', 409)
    if (!before.includes(sessionId)) return { restored: false, data: await list() }

    if (capability.mode === 'native') await workspaceRegistry.unarchiveSession(sessionId)
    else await restoreWithCompatibilityAdapter(workspaceRegistry, sessionId, compatibilityCheck)

    const after = archivedIdsOf(workspaceRegistry)
    if (after === null) throw new PublicArchiveError('restore-verification-failed', '恢复后无法验证归档集合，请刷新确认', 500)
    if (after.includes(sessionId)) {
      throw new PublicArchiveError('restore-not-committed', 'DSH 未确认该会话已恢复，请刷新后重试', 409)
    }
    return { restored: true, data: await list() }
  }

  return { list, restore }
}

function json(res, statusCode, body, extraHeaders = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  })
  res.end(payload)
}

function isCrossSite(req) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') return true
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try {
    const parsed = new URL(origin)
    const requestProtocol = req.socket?.encrypted === true ? 'https:' : 'http:'
    return parsed.host !== host || parsed.protocol !== requestProtocol
  } catch { return true }
}

function hasStrictSameOriginMutationHeaders(req) {
  const origin = req.headers.origin
  const host = req.headers.host
  const fetchSite = req.headers['sec-fetch-site']
  if (typeof origin !== 'string' || typeof host !== 'string' || fetchSite !== 'same-origin') return false
  try {
    const parsed = new URL(origin)
    const requestProtocol = req.socket?.encrypted === true ? 'https:' : 'http:'
    return parsed.protocol === requestProtocol && parsed.host === host
  } catch { return false }
}

function isLoopbackAddress(address) {
  return typeof address === 'string'
    && (address === '::1' || /^127\./.test(address) || /^::ffff:127\./i.test(address))
}

function isLoopbackAuthority(authority) {
  if (typeof authority !== 'string' || authority.trim() === '') return false
  try {
    const hostname = new URL(`http://${authority}`).hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '[::1]' || /^127\./.test(hostname)
  } catch { return false }
}

function hasForwardingHeaders(req) {
  return ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip']
    .some((header) => req.headers[header] !== undefined)
}

function isDirectLoopbackRequest(req) {
  return isLoopbackAddress(req.socket?.remoteAddress)
    && isLoopbackAuthority(req.headers.host)
    && !hasForwardingHeaders(req)
}

async function readJsonBody(req) {
  const contentType = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'].toLowerCase() : ''
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    throw new PublicArchiveError('invalid-request', '请求必须使用 JSON', 400)
  }
  const declared = req.headers['content-length']
  if (typeof declared === 'string' && /^\d+$/.test(declared.trim()) && Number(declared) > MAX_REQUEST_BYTES) {
    throw new PublicArchiveError('request-too-large', '请求内容过大', 413)
  }
  const chunks = []
  let received = 0
  for await (const chunkValue of req) {
    const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue)
    received += chunk.byteLength
    if (received > MAX_REQUEST_BYTES) throw new PublicArchiveError('request-too-large', '请求内容过大', 413)
    chunks.push(chunk)
  }
  let body
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    body = JSON.parse(text)
  } catch {
    throw new PublicArchiveError('invalid-request', '请求 JSON 无效', 400)
  }
  if (record(body) === null) throw new PublicArchiveError('invalid-request', '请求 JSON 无效', 400)
  return body
}

function publicError(error, fallbackMessage) {
  if (error instanceof PublicArchiveError) return error
  return new PublicArchiveError('internal-error', fallbackMessage, 500)
}

function rejectUntrusted(req, res) {
  if (!isDirectLoopbackRequest(req)) {
    json(res, 403, { ok: false, error: { code: 'remote-access-disabled', message: '归档管理仅允许本机访问' } })
    return true
  }
  if (isCrossSite(req)) {
    json(res, 403, { ok: false, error: { code: 'forbidden', message: '拒绝跨站请求' } })
    return true
  }
  return false
}

export function createListHandler(manager, logger) {
  return async function listHandler(req, res) {
    if (rejectUntrusted(req, res)) return
    if (req.method !== 'GET') {
      json(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '仅支持 GET 请求' } }, { allow: 'GET' })
      return
    }
    try {
      json(res, 200, { ok: true, data: await manager.list() })
    } catch (error) {
      logger?.warn?.(`archived session list failed: ${String(error)}`)
      const safe = publicError(error, '暂时无法读取已归档会话')
      json(res, safe.statusCode, { ok: false, error: { code: safe.code, message: safe.message } })
    }
  }
}

export function createRestoreHandler(manager, logger) {
  return async function restoreHandler(req, res) {
    if (rejectUntrusted(req, res)) return
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '仅支持 POST 请求' } }, { allow: 'POST' })
      return
    }
    if (!hasStrictSameOriginMutationHeaders(req)) {
      json(res, 403, { ok: false, error: { code: 'forbidden', message: '恢复请求缺少可信的同源浏览器标记' } })
      return
    }
    try {
      const body = await readJsonBody(req)
      json(res, 200, { ok: true, ...(await manager.restore(body.sessionId)) })
    } catch (error) {
      logger?.warn?.(`archived session restore failed: ${String(error)}`)
      const safe = publicError(error, '恢复会话失败，请稍后重试')
      json(res, safe.statusCode, { ok: false, error: { code: safe.code, message: safe.message } })
    }
  }
}

export function apply(ctx) {
  requireMethod(ctx.webServer, 'webServer', 'register')
  const manager = createArchiveManager({
    workspaceRegistry: ctx.workspaceRegistry,
    sessionQuery: ctx.sessionQuery,
  })
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: LIST_ROUTE_PATH,
    handler: createListHandler(manager, ctx.logger),
  }), 'archived-sessions: list route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: RESTORE_ROUTE_PATH,
    handler: createRestoreHandler(manager, ctx.logger),
  }), 'archived-sessions: restore route')
}
