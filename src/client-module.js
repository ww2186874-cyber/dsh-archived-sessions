const React = require('react')

const LIST_ROUTE_PATH = '/archived-sessions/api/list'
const RESTORE_ROUTE_PATH = '/archived-sessions/api/restore'

function normalizeSession(value) {
  if (typeof value !== 'object' || value === null || typeof value.id !== 'string') return null
  return {
    id: value.id,
    title: typeof value.title === 'string' && value.title.trim() !== '' ? value.title : value.id,
    cwd: typeof value.cwd === 'string' ? value.cwd : null,
    createdAt: Number.isSafeInteger(value.createdAt) && value.createdAt >= 0 ? value.createdAt : null,
    agentPreset: typeof value.agentPreset === 'string' ? value.agentPreset : null,
    workspaceId: typeof value.workspaceId === 'string' ? value.workspaceId : null,
    workspaceTitle: typeof value.workspaceTitle === 'string' ? value.workspaceTitle : null,
    available: value.available === true,
  }
}

function normalizeCapability(value) {
  if (typeof value !== 'object' || value === null) {
    return { canRestore: false, mode: 'unsupported', message: '无法识别 Host 恢复能力。' }
  }
  return {
    canRestore: value.canRestore === true,
    mode: value.mode === 'native' || value.mode === 'compatibility' ? value.mode : 'unsupported',
    message: typeof value.message === 'string' ? value.message : '',
  }
}

function normalizeArchiveData(value) {
  if (typeof value !== 'object' || value === null || !Array.isArray(value.sessions)) {
    throw new Error('Host 返回了无效的归档数据')
  }
  const sessions = value.sessions.map(normalizeSession).filter((item) => item !== null)
  return {
    sessions,
    archivedCount: Number.isSafeInteger(value.archivedCount) && value.archivedCount >= 0
      ? value.archivedCount
      : sessions.length,
    capability: normalizeCapability(value.capability),
  }
}

async function responseBody(response, fallback) {
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.error?.message || `${fallback}（HTTP ${response.status}）`)
  }
  return body
}

async function fetchArchiveList(fetchImpl, signal) {
  const response = await fetchImpl(LIST_ROUTE_PATH, {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  })
  const body = await responseBody(response, '读取已归档会话失败')
  return normalizeArchiveData(body.data)
}

async function restoreArchiveSession(fetchImpl, sessionId, signal) {
  const response = await fetchImpl(RESTORE_ROUTE_PATH, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    cache: 'no-store',
    credentials: 'same-origin',
    body: JSON.stringify({ sessionId }),
    signal,
  })
  const body = await responseBody(response, '恢复会话失败')
  return { restored: body.restored === true, data: normalizeArchiveData(body.data) }
}

function formatDate(value) {
  if (!Number.isSafeInteger(value) || value < 0) return '时间未知'
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(value))
  } catch { return '时间未知' }
}

function ArchiveIcon({ size = 18 }) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true', focusable: 'false',
  },
  React.createElement('path', { d: 'M4 7.5h16v12H4z' }),
  React.createElement('path', { d: 'M3 4.5h18v3H3z' }),
  React.createElement('path', { d: 'M9.5 11.5h5' }))
}

function RestoreIcon() {
  return React.createElement('svg', {
    width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true', focusable: 'false',
  },
  React.createElement('path', { d: 'M3 12a9 9 0 1 0 3-6.7' }),
  React.createElement('path', { d: 'M3 4.5v6h6' }))
}

function RefreshIcon() {
  return React.createElement('svg', {
    width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true', focusable: 'false',
  },
  React.createElement('path', { d: 'M20 11a8 8 0 1 0-2.3 5.7' }),
  React.createElement('path', { d: 'M20 4v7h-7' }))
}

function SessionMetadata({ session }) {
  const items = []
  if (session.workspaceTitle) items.push(session.workspaceTitle)
  if (session.agentPreset) items.push(`Preset: ${session.agentPreset}`)
  items.push(formatDate(session.createdAt))
  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'dsh-archive-row__meta' },
      items.map((item, index) => React.createElement('span', { key: `${index}:${item}` }, item))),
    session.cwd ? React.createElement('div', { className: 'dsh-archive-row__path', title: session.cwd }, session.cwd) : null,
    !session.available
      ? React.createElement('div', { className: 'dsh-archive-row__warning' }, '会话日志当前不可用；恢复操作只会将其移出归档集合。')
      : null)
}

function ArchiveRow({ session, capability, busySessionId, listLoading, onRestore }) {
  const busy = busySessionId === session.id
  const disabled = listLoading || busySessionId !== null || !capability.canRestore
  return React.createElement('article', { className: 'dsh-archive-row' },
    React.createElement('div', { className: 'dsh-archive-row__mark' }, React.createElement(ArchiveIcon, { size: 19 })),
    React.createElement('div', { className: 'dsh-archive-row__body' },
      React.createElement('h3', null, session.title),
      React.createElement(SessionMetadata, { session })),
    React.createElement('button', {
      type: 'button',
      className: 'dsh-archive-row__restore',
      disabled,
      onClick: () => onRestore(session),
      title: capability.canRestore ? `恢复“${session.title}”` : capability.message,
    }, React.createElement(RestoreIcon), busy ? '正在恢复…' : '恢复'))
}

function restoreNotice(session, restored) {
  if (!restored) return '该会话已经不在归档集合中。'
  return `“${session.title}”已从归档集合移除，请在侧栏确认会话状态。`
}

function createArchiveRequestGate() {
  let activeLoad = null
  let activeRestore = null
  let deferredLoad = false
  return {
    beginLoad() {
      if (activeLoad !== null || activeRestore !== null) {
        deferredLoad = true
        return null
      }
      activeLoad = {}
      return activeLoad
    },
    endLoad(token) {
      if (activeLoad !== token) return false
      activeLoad = null
      const shouldLoad = deferredLoad && activeRestore === null
      if (shouldLoad) deferredLoad = false
      return shouldLoad
    },
    beginRestore() {
      if (activeLoad !== null || activeRestore !== null) return null
      activeRestore = {}
      return activeRestore
    },
    endRestore(token) {
      if (activeRestore !== token) return false
      activeRestore = null
      const shouldLoad = deferredLoad
      deferredLoad = false
      return shouldLoad
    },
    cancel() {
      activeLoad = null
      activeRestore = null
      deferredLoad = false
    },
  }
}

function ArchiveSettingsSection({ useWorkspaces }) {
  const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds)
  const archiveSignature = archivedSessionIds.join('\u0000')
  const [view, setView] = React.useState({ data: null, loading: false, error: null, notice: null })
  const [busySessionId, setBusySessionId] = React.useState(null)
  const loadController = React.useRef(null)
  const restoreController = React.useRef(null)
  const requestGate = React.useRef(null)
  if (requestGate.current === null) requestGate.current = createArchiveRequestGate()

  const load = React.useCallback(async () => {
    const gate = requestGate.current
    const gateToken = gate.beginLoad()
    if (gateToken === null) return
    const controller = new AbortController()
    loadController.current?.abort()
    loadController.current = controller
    setView((previous) => ({ ...previous, loading: true, error: null }))
    try {
      const data = await fetchArchiveList((...args) => fetch(...args), controller.signal)
      if (!controller.signal.aborted) {
        setView((previous) => ({ ...previous, data, loading: false, error: null }))
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setView((previous) => ({ ...previous, loading: false, error: error?.message || '读取已归档会话失败' }))
      }
    } finally {
      if (loadController.current === controller) loadController.current = null
      const shouldLoad = gate.endLoad(gateToken)
      if (shouldLoad && !controller.signal.aborted) load()
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [archiveSignature, load])

  React.useEffect(() => () => {
    requestGate.current.cancel()
    loadController.current?.abort()
    loadController.current = null
    restoreController.current?.abort()
    restoreController.current = null
  }, [])

  const restore = async (session) => {
    const gate = requestGate.current
    if (busySessionId !== null || view.loading || loadController.current !== null || !view.data?.capability.canRestore) return
    const gateToken = gate.beginRestore()
    if (gateToken === null) return
    const controller = new AbortController()
    restoreController.current = controller
    setBusySessionId(session.id)
    setView((previous) => ({ ...previous, error: null, notice: null }))
    try {
      const result = await restoreArchiveSession((...args) => fetch(...args), session.id, controller.signal)
      if (!controller.signal.aborted) {
        setView({
          data: result.data,
          loading: false,
          error: null,
          notice: restoreNotice(session, result.restored),
        })
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setView((previous) => ({ ...previous, error: error?.message || '恢复会话失败' }))
      }
    } finally {
      if (restoreController.current === controller) restoreController.current = null
      const shouldLoad = gate.endRestore(gateToken)
      if (!controller.signal.aborted) {
        setBusySessionId(null)
        if (shouldLoad) load()
      }
    }
  }

  const data = view.data
  const sessions = data?.sessions ?? []
  const capability = data?.capability ?? { canRestore: false, mode: 'unsupported', message: '正在检测恢复能力…' }

  return React.createElement('section', { className: 'dsh-archive-settings', 'aria-labelledby': 'dsh-archive-settings-title' },
    React.createElement('header', { className: 'dsh-archive-settings__header' },
      React.createElement('div', { className: 'dsh-archive-settings__hero' },
        React.createElement('span', { className: 'dsh-archive-settings__mark' }, React.createElement(ArchiveIcon, { size: 22 })),
        React.createElement('h2', { id: 'dsh-archive-settings-title' }, '已归档会话')),
      React.createElement('button', {
        type: 'button',
        className: 'dsh-archive-settings__refresh',
        onClick: load,
        disabled: view.loading || busySessionId !== null,
        title: '刷新已归档会话',
      }, React.createElement(RefreshIcon), view.loading ? '刷新中…' : '刷新')),
    React.createElement('div', { className: 'dsh-archive-settings__content' },
      data !== null && !capability.canRestore
        ? React.createElement('div', { className: 'dsh-archive-capability', role: 'status' }, capability.message || '当前无法安全恢复会话。')
        : null,
      view.notice ? React.createElement('div', { className: 'dsh-archive-notice is-success', role: 'status' }, view.notice) : null,
      view.error ? React.createElement('div', { className: 'dsh-archive-notice is-error', role: 'alert' },
        React.createElement('span', null, view.error),
        React.createElement('button', { type: 'button', onClick: load }, '重试')) : null,
      view.loading && data === null
        ? React.createElement('div', { className: 'dsh-archive-empty' },
          React.createElement('span', { className: 'dsh-archive-spinner', 'aria-hidden': 'true' }),
          React.createElement('strong', null, '正在读取已归档会话…'))
        : null,
      !view.loading && data !== null && sessions.length === 0
        ? React.createElement('div', { className: 'dsh-archive-empty' },
          React.createElement('span', { className: 'dsh-archive-empty__mark' }, React.createElement(ArchiveIcon, { size: 30 })),
          React.createElement('strong', null, '没有已归档会话'))
        : null,
      sessions.length > 0
        ? React.createElement('div', { className: 'dsh-archive-list' },
          sessions.map((session) => React.createElement(ArchiveRow, {
            key: session.id, session, capability, busySessionId, listLoading: view.loading, onRestore: restore,
          })))
        : null))
}

const css = `
.dsh-archive-settings{box-sizing:border-box;width:min(900px,100%);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:16px}.dsh-archive-settings__header{display:flex;align-items:center;justify-content:space-between;gap:16px}.dsh-archive-settings__hero{display:flex;align-items:center;gap:12px;min-width:0}.dsh-archive-settings__mark{width:42px;height:42px;display:flex;align-items:center;justify-content:center;flex:none;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f7cff) 14%,transparent);color:var(--dsw-alias-brand-primary,#4f7cff)}.dsh-archive-settings h2{margin:0;font-size:19px;line-height:27px}.dsh-archive-settings__refresh,.dsh-archive-row__restore{height:34px;flex:none;border:0;border-radius:17px;padding:0 14px;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font:inherit;font-size:12px;font-weight:600;cursor:pointer}.dsh-archive-settings__refresh:disabled,.dsh-archive-row__restore:disabled{cursor:not-allowed;opacity:.5}.dsh-archive-settings__refresh:focus-visible,.dsh-archive-row__restore:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}.dsh-archive-settings__content{min-width:0;display:flex;flex-direction:column;gap:12px}
.dsh-archive-capability{box-sizing:border-box;padding:11px 13px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#df4b4b) 36%,var(--dsw-alias-border-l1));border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#df4b4b) 7%,transparent);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.dsh-archive-notice{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 13px;border-radius:9px;font-size:13px;line-height:19px}.dsh-archive-notice.is-success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22a06b) 11%,transparent);color:var(--dsw-alias-state-success-primary,#14845a)}.dsh-archive-notice.is-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#df4b4b) 10%,transparent);color:var(--dsw-alias-state-error-primary,#df4b4b)}.dsh-archive-notice button{border:0;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer;text-decoration:underline}
.dsh-archive-list{display:flex;flex-direction:column;gap:10px}.dsh-archive-row{box-sizing:border-box;display:flex;align-items:center;gap:13px;padding:15px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base));transition:border-color .16s ease,transform .16s ease}.dsh-archive-row:hover{border-color:var(--dsw-alias-border-l2);transform:translateY(-1px)}.dsh-archive-row__mark{width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:none;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}.dsh-archive-row__body{flex:1;min-width:0}.dsh-archive-row h3{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:21px}.dsh-archive-row__meta{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:3px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px}.dsh-archive-row__path{margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,Consolas,monospace;font-size:11px}.dsh-archive-row__warning{margin-top:5px;color:var(--dsw-alias-state-warn-primary,#b77b00);font-size:11px}
.dsh-archive-empty{min-height:240px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--dsw-alias-label-secondary)}.dsh-archive-empty__mark{width:58px;height:58px;margin-bottom:13px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}.dsh-archive-empty strong{font-size:15px}.dsh-archive-spinner{width:24px;height:24px;margin-bottom:12px;border:2px solid var(--dsw-alias-border-l1);border-top-color:var(--dsw-alias-brand-primary,#4f7cff);border-radius:50%;animation:dsh-archive-spin .8s linear infinite}@keyframes dsh-archive-spin{to{transform:rotate(360deg)}}
@media (max-width:640px){.dsh-archive-settings__header{align-items:flex-start}.dsh-archive-settings__refresh{width:34px;padding:0;font-size:0}.dsh-archive-settings__refresh svg{width:17px;height:17px}.dsh-archive-row{align-items:flex-start;flex-wrap:wrap}.dsh-archive-row__body{width:calc(100% - 49px)}.dsh-archive-row__restore{margin-left:49px}}
@media (prefers-reduced-motion:reduce){.dsh-archive-row{transition:none}.dsh-archive-spinner{animation-duration:1.8s}}
`

const inject = ['slots']
function apply(ctx) {
  if (typeof ctx.slots?.inject !== 'function' || typeof ctx.slots?.register !== 'function') {
    throw new Error('dsh-archived-sessions requires slots.inject() and slots.register()')
  }
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-archived-sessions'
    tag.textContent = css
    document.head.appendChild(tag)
    return () => tag.remove()
  }, 'archived-sessions: styles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'archived-sessions',
    order: 25,
    label: '已归档会话',
  }, ArchiveSettingsSection))
}

exports.apply = apply
exports.inject = inject
exports.createArchiveRequestGate = createArchiveRequestGate
exports.restoreNotice = restoreNotice
exports.normalizeArchiveData = normalizeArchiveData
exports.fetchArchiveList = fetchArchiveList
exports.restoreArchiveSession = restoreArchiveSession
exports.formatDate = formatDate
exports.ArchiveRow = ArchiveRow
exports.ArchiveSettingsSection = ArchiveSettingsSection
