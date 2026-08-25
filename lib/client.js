window.__ModuleLoader__.load({
  id: "dsh-archived-sessions",
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    const LIST_ROUTE_PATH = '/archived-sessions/api/list'
    const RESTORE_ROUTE_PATH = '/archived-sessions/api/restore'

    function createPageStore() {
      let opened = false
      let opener = null
      const listeners = new Set()
      const emit = () => { for (const listener of listeners) listener() }
      return {
        getSnapshot: () => opened,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        open(nextOpener) {
          if (nextOpener && typeof nextOpener.focus === 'function') opener = nextOpener
          if (!opened) { opened = true; emit() }
        },
        close({ restoreFocus = true } = {}) {
          if (!opened) return
          opened = false
          emit()
          const target = opener
          opener = null
          if (restoreFocus && target?.isConnected && typeof target.focus === 'function') target.focus()
        },
      }
    }

    const pageStore = createPageStore()

    function usePageOpen() {
      return React.useSyncExternalStore(pageStore.subscribe, pageStore.getSnapshot, pageStore.getSnapshot)
    }

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

    function CloseIcon() {
      return React.createElement('svg', {
        width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round',
        'aria-hidden': 'true', focusable: 'false',
      }, React.createElement('path', { d: 'M6 6l12 12M18 6 6 18' }))
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

    function ArchiveFooterAction({ wide, useWorkspaces }) {
      const archivedCount = useWorkspaces((state) => state.archivedSessionIds.length)
      const label = archivedCount === 0 ? '已归档会话' : `已归档会话，${archivedCount} 个`
      return React.createElement('button', {
        type: 'button',
        className: `dsh-archive-footer${wide ? ' is-wide' : ' is-rail'}`,
        onClick: (event) => pageStore.open(event.currentTarget),
        'aria-label': label,
        title: wide ? undefined : label,
      },
      React.createElement('span', { className: 'dsh-archive-footer__icon' }, React.createElement(ArchiveIcon, { size: 18 })),
      wide ? React.createElement('span', { className: 'dsh-archive-footer__label' }, '已归档会话') : null,
      archivedCount > 0
        ? React.createElement('span', { className: 'dsh-archive-footer__count', 'aria-hidden': 'true' }, archivedCount > 99 ? '99+' : String(archivedCount))
        : null)
    }

    function ArchiveSettingsSection({ close, useWorkspaces }) {
      const archivedCount = useWorkspaces((state) => state.archivedSessionIds.length)
      const openManager = (event) => {
        pageStore.open(event.currentTarget)
        close()
      }
      return React.createElement('section', { className: 'dsh-archive-settings' },
        React.createElement('div', { className: 'dsh-archive-settings__hero' },
          React.createElement('span', { className: 'dsh-archive-settings__mark' }, React.createElement(ArchiveIcon, { size: 22 })),
          React.createElement('div', null,
            React.createElement('h2', null, '已归档会话'),
            React.createElement('p', null, '集中查看和恢复被归档的会话。恢复不会复制、改写或删除会话日志。'))),
        React.createElement('div', { className: 'dsh-archive-settings__card' },
          React.createElement('div', null,
            React.createElement('strong', null, archivedCount === 0 ? '当前没有已归档会话' : `当前有 ${archivedCount} 个已归档会话`),
            React.createElement('p', null, '管理页面使用 DSH 的公开 Slot 以插件形式加载，可随时卸载。')),
          React.createElement('button', { type: 'button', onClick: openManager }, '打开归档管理')),
        React.createElement('div', { className: 'dsh-archive-settings__note' },
          React.createElement('strong', null, '兼容策略'),
          React.createElement('p', null, '插件会优先采用 DSH 官方恢复接口；若当前版本尚未提供，则仅在归档结构通过严格检测时启用兼容适配器。检测失败时恢复按钮会安全禁用。')))
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
          ? React.createElement('div', { className: 'dsh-archive-row__warning' }, '会话日志当前不可用；仍可从归档集合恢复其显示状态。')
          : null)
    }

    function ArchiveRow({ session, capability, busySessionId, onRestore }) {
      const busy = busySessionId === session.id
      const disabled = busySessionId !== null || !capability.canRestore
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

    function ArchivePage({ useWorkspaces }) {
      const opened = usePageOpen()
      const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds)
      const archiveSignature = archivedSessionIds.join('\u0000')
      const [view, setView] = React.useState({ data: null, loading: false, error: null, notice: null })
      const [busySessionId, setBusySessionId] = React.useState(null)
      const loadController = React.useRef(null)
      const restoreController = React.useRef(null)
      const closeButton = React.useRef(null)
      const dialog = React.useRef(null)
      const mounted = React.useRef(true)

      const load = React.useCallback(async () => {
        const controller = new AbortController()
        loadController.current?.abort()
        loadController.current = controller
        setView((previous) => ({ ...previous, loading: true, error: null }))
        try {
          const data = await fetchArchiveList((...args) => fetch(...args), controller.signal)
          if (!controller.signal.aborted) setView((previous) => ({ ...previous, data, loading: false, error: null }))
        } catch (error) {
          if (!controller.signal.aborted) {
            setView((previous) => ({ ...previous, loading: false, error: error?.message || '读取已归档会话失败' }))
          }
        } finally {
          if (loadController.current === controller) loadController.current = null
        }
      }, [])

      React.useEffect(() => {
        if (!opened) return undefined
        load()
        return () => {
          loadController.current?.abort()
          loadController.current = null
        }
      }, [opened, archiveSignature, load])

      React.useEffect(() => {
        if (!opened) return undefined
        closeButton.current?.focus()
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            pageStore.close()
            return
          }
          if (event.key !== 'Tab') return
          const focusable = [...(dialog.current?.querySelectorAll('button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])') ?? [])]
          if (focusable.length === 0) return
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [opened])

      React.useEffect(() => {
        if (opened) return undefined
        restoreController.current?.abort()
        restoreController.current = null
        setBusySessionId(null)
        return undefined
      }, [opened])

      React.useEffect(() => () => {
        mounted.current = false
        loadController.current?.abort()
        restoreController.current?.abort()
      }, [])

      const restore = async (session) => {
        if (busySessionId !== null) return
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
              notice: result.restored ? `“${session.title}”已恢复，可在侧栏会话列表中找到。` : '该会话已经不在归档集合中。',
            })
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            setView((previous) => ({ ...previous, error: error?.message || '恢复会话失败' }))
          }
        } finally {
          if (restoreController.current === controller) restoreController.current = null
          if (mounted.current) setBusySessionId(null)
        }
      }

      if (!opened) return null
      const data = view.data
      const sessions = data?.sessions ?? []
      const capability = data?.capability ?? { canRestore: false, mode: 'unsupported', message: '正在检测恢复能力…' }

      return React.createElement('div', { ref: dialog, className: 'dsh-archive-page', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dsh-archive-title' },
        React.createElement('header', { className: 'dsh-archive-page__header' },
          React.createElement('div', { className: 'dsh-archive-page__title' },
            React.createElement('span', { className: 'dsh-archive-page__title-mark' }, React.createElement(ArchiveIcon, { size: 22 })),
            React.createElement('div', null,
              React.createElement('h1', { id: 'dsh-archive-title' }, '已归档会话'),
              React.createElement('p', null, data === null ? '读取归档列表…' : `${data.archivedCount} 个会话`))),
          React.createElement('div', { className: 'dsh-archive-page__actions' },
            React.createElement('button', { type: 'button', className: 'is-secondary', onClick: load, disabled: view.loading || busySessionId !== null }, React.createElement(RefreshIcon), view.loading ? '刷新中…' : '刷新'),
            React.createElement('button', { ref: closeButton, type: 'button', className: 'is-icon', onClick: pageStore.close, 'aria-label': '关闭已归档会话页面' }, React.createElement(CloseIcon)))),
        React.createElement('main', { className: 'dsh-archive-page__main' },
          data !== null
            ? React.createElement('div', { className: `dsh-archive-capability is-${capability.mode}` },
              React.createElement('strong', null, capability.canRestore ? '恢复功能可用' : '恢复功能已安全禁用'),
              React.createElement('span', null, capability.message))
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
              React.createElement('strong', null, '没有已归档会话'),
              React.createElement('p', null, '从侧栏会话菜单归档的会话会显示在这里。'))
            : null,
          sessions.length > 0
            ? React.createElement('div', { className: 'dsh-archive-list' },
              sessions.map((session) => React.createElement(ArchiveRow, {
                key: session.id, session, capability, busySessionId, onRestore: restore,
              })))
            : null))
    }

    const css = `
    .dsh-archive-footer{box-sizing:border-box;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;position:relative;display:flex;align-items:center;transition:background .16s ease,color .16s ease}
    .dsh-archive-footer:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.dsh-archive-footer:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4f7cff);outline-offset:2px}
    .dsh-archive-footer.is-wide{width:100%;min-height:36px;padding:7px 9px;border-radius:8px;gap:9px}.dsh-archive-footer.is-rail{width:36px;height:36px;border-radius:9px;justify-content:center}
    .dsh-archive-footer__icon{display:flex;flex:none}.dsh-archive-footer__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.dsh-archive-footer__count{min-width:18px;height:18px;margin-left:auto;padding:0 5px;border-radius:9px;background:var(--dsw-alias-brand-primary,#4f7cff);color:#fff;font-size:10px;font-weight:700;line-height:18px;text-align:center}.dsh-archive-footer.is-rail .dsh-archive-footer__count{position:absolute;top:0;right:-2px;min-width:14px;height:14px;padding:0 3px;font-size:8px;line-height:14px}
    .dsh-archive-settings{box-sizing:border-box;max-width:720px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:18px}.dsh-archive-settings__hero{display:flex;align-items:flex-start;gap:12px}.dsh-archive-settings__mark,.dsh-archive-page__title-mark{display:flex;align-items:center;justify-content:center;flex:none;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f7cff) 14%,transparent);color:var(--dsw-alias-brand-primary,#4f7cff)}.dsh-archive-settings__mark{width:42px;height:42px}.dsh-archive-settings h2{margin:0;font-size:19px;line-height:27px}.dsh-archive-settings p{margin:3px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.dsh-archive-settings__card{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base)}.dsh-archive-settings__card strong{font-size:14px}.dsh-archive-settings__card button,.dsh-archive-settings__note button{flex:none;height:36px;border:0;border-radius:18px;padding:0 16px;background:var(--dsw-alias-brand-primary);color:#fff;font:inherit;cursor:pointer}.dsh-archive-settings__note{padding:14px 16px;border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.dsh-archive-settings__note strong{font-size:13px}
    .dsh-archive-page{pointer-events:auto;position:fixed;inset:0;z-index:30;box-sizing:border-box;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit}.dsh-archive-page__header{flex:none;min-height:72px;box-sizing:border-box;padding:14px clamp(18px,4vw,52px);display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base))}.dsh-archive-page__title{display:flex;align-items:center;gap:12px;min-width:0}.dsh-archive-page__title-mark{width:42px;height:42px}.dsh-archive-page__title h1{margin:0;font-size:20px;line-height:27px}.dsh-archive-page__title p{margin:1px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}.dsh-archive-page__actions{display:flex;align-items:center;gap:8px}.dsh-archive-page__actions button{height:36px;border:0;border-radius:18px;display:inline-flex;align-items:center;justify-content:center;gap:7px;font:inherit;cursor:pointer}.dsh-archive-page__actions button:disabled{cursor:not-allowed;opacity:.55}.dsh-archive-page__actions .is-secondary{padding:0 14px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.dsh-archive-page__actions .is-icon{width:36px;background:transparent;color:var(--dsw-alias-label-secondary)}.dsh-archive-page__actions .is-icon:hover{background:var(--dsw-alias-bg-layer-2)}
    .dsh-archive-page__main{flex:1;min-height:0;overflow:auto;box-sizing:border-box;padding:24px clamp(18px,6vw,80px) 48px}.dsh-archive-page__main>*{max-width:1040px;margin-left:auto;margin-right:auto}.dsh-archive-capability{box-sizing:border-box;display:flex;align-items:flex-start;gap:10px;margin-bottom:16px;padding:10px 13px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.dsh-archive-capability strong{flex:none;color:var(--dsw-alias-label-primary)}.dsh-archive-capability.is-unsupported{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#df4b4b) 36%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#df4b4b) 7%,transparent)}.dsh-archive-capability.is-compatibility{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d49b16) 38%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d49b16) 8%,transparent)}
    .dsh-archive-notice{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:16px;padding:11px 13px;border-radius:9px;font-size:13px;line-height:19px}.dsh-archive-notice.is-success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22a06b) 11%,transparent);color:var(--dsw-alias-state-success-primary,#14845a)}.dsh-archive-notice.is-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#df4b4b) 10%,transparent);color:var(--dsw-alias-state-error-primary,#df4b4b)}.dsh-archive-notice button{border:0;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer;text-decoration:underline}
    .dsh-archive-list{display:flex;flex-direction:column;gap:10px}.dsh-archive-row{box-sizing:border-box;display:flex;align-items:center;gap:13px;padding:15px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base));transition:border-color .16s ease,transform .16s ease}.dsh-archive-row:hover{border-color:var(--dsw-alias-border-l2);transform:translateY(-1px)}.dsh-archive-row__mark{width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:none;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}.dsh-archive-row__body{flex:1;min-width:0}.dsh-archive-row h3{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:21px}.dsh-archive-row__meta{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:3px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px}.dsh-archive-row__path{margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,Consolas,monospace;font-size:11px}.dsh-archive-row__warning{margin-top:5px;color:#b77b00;font-size:11px}.dsh-archive-row__restore{height:34px;flex:none;border:0;border-radius:17px;padding:0 14px;display:inline-flex;align-items:center;gap:6px;background:var(--dsw-alias-brand-primary);color:#fff;font:inherit;font-size:12px;cursor:pointer}.dsh-archive-row__restore:disabled{cursor:not-allowed;opacity:.5}
    .dsh-archive-empty{min-height:300px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--dsw-alias-label-secondary)}.dsh-archive-empty__mark{width:58px;height:58px;margin-bottom:13px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}.dsh-archive-empty strong{font-size:15px}.dsh-archive-empty p{margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}.dsh-archive-spinner{width:24px;height:24px;margin-bottom:12px;border:2px solid var(--dsw-alias-border-l1);border-top-color:var(--dsw-alias-brand-primary,#4f7cff);border-radius:50%;animation:dsh-archive-spin .8s linear infinite}@keyframes dsh-archive-spin{to{transform:rotate(360deg)}}
    @media (max-width:640px){.dsh-archive-page__header{padding:12px 14px}.dsh-archive-page__actions .is-secondary{width:36px;padding:0;font-size:0}.dsh-archive-page__actions .is-secondary svg{width:17px;height:17px}.dsh-archive-page__main{padding:18px 12px 36px}.dsh-archive-capability{flex-direction:column;gap:2px}.dsh-archive-row{align-items:flex-start;flex-wrap:wrap}.dsh-archive-row__body{width:calc(100% - 49px)}.dsh-archive-row__restore{margin-left:49px}.dsh-archive-settings__card{align-items:flex-start;flex-direction:column}}
    @media (prefers-reduced-motion:reduce){.dsh-archive-row{transition:none}.dsh-archive-spinner{animation-duration:1.8s}}
    `

    const inject = ['slots']
    function apply(ctx) {
      if (typeof ctx.slots?.inject !== 'function' || typeof ctx.slots?.register !== 'function') {
        throw new Error('dsh-archived-sessions requires slots.inject() and slots.register()')
      }
      ctx.effect(() => () => pageStore.close({ restoreFocus: false }), 'archived-sessions: page state')
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-archived-sessions'
        tag.textContent = css
        document.head.appendChild(tag)
        return () => tag.remove()
      }, 'archived-sessions: styles')
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'archived-sessions',
        order: -80,
        label: '已归档会话',
      }, ArchiveFooterAction))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'archived-sessions',
        order: 25,
        label: '已归档会话',
      }, ArchiveSettingsSection))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'archived-sessions-page',
        order: 20,
        label: '已归档会话页面',
      }, ArchivePage))
    }

    exports.apply = apply
    exports.inject = inject
    exports.createPageStore = createPageStore
    exports.normalizeArchiveData = normalizeArchiveData
    exports.fetchArchiveList = fetchArchiveList
    exports.restoreArchiveSession = restoreArchiveSession
    exports.formatDate = formatDate
    exports.ArchiveFooterAction = ArchiveFooterAction
    exports.ArchiveSettingsSection = ArchiveSettingsSection
    exports.ArchivePage = ArchivePage

    return module.exports
  },
})
