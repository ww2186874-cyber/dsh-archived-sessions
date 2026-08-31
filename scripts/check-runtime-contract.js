import { createHash } from 'node:crypto'
import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { matchesAlpha2CompatibilityRegistry } from '../lib/index.js'

const EXPECTED_DSH_VERSION = '0.1.2-alpha.2'
const EXPECTED_WORKSPACE_BUNDLE_SHA256 = 'eea81b03fd61039725adff9255f8a86055c449075ce8a62c8a3f3fd0b041b4a5'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function runtimeRoot() {
  const explicit = process.argv[2] || process.env.DSH_RUNTIME_ROOT
  if (explicit) return resolve(explicit)
  const base = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'dsh-runtime')
  if (!base || !(await exists(base))) {
    throw new Error('set DSH_RUNTIME_ROOT or pass the runtime checkout path as the first argument')
  }
  const candidates = []
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidate = join(base, entry.name)
    if (await exists(join(candidate, 'package.json')) && await exists(join(candidate, 'node_modules', '.pnpm'))) candidates.push(candidate)
  }
  if (candidates.length !== 1) {
    throw new Error(`found ${candidates.length} DSH runtime checkouts; pass one explicitly (candidates: ${candidates.join(', ') || 'none'})`)
  }
  return candidates[0]
}

async function packageRoots(runtime, name) {
  const pnpm = join(runtime, 'node_modules', '.pnpm')
  const entries = (await readdir(pnpm, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(pnpm, entry.name, 'node_modules', ...name.split('/')))
  const existing = []
  for (const path of entries) if (await exists(join(path, 'package.json'))) existing.push(path)
  if (existing.length === 0) throw new Error(`runtime package ${name} was not found under ${pnpm}`)
  const byVersion = new Map()
  for (const path of existing) {
    const manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'))
    const list = byVersion.get(manifest.version) ?? []
    list.push(path)
    byVersion.set(manifest.version, list)
  }
  if (byVersion.size !== 1) throw new Error(`runtime contains multiple ${name} versions: ${[...byVersion.keys()].join(', ')}`)
  const [version] = byVersion.keys()
  if (version !== EXPECTED_DSH_VERSION) {
    throw new Error(`runtime package ${name} is ${String(version)}; expected ${EXPECTED_DSH_VERSION}`)
  }
  return existing.sort()
}

async function allTypeText(path) {
  const chunks = []
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = join(current, entry.name)
      if (entry.isDirectory()) await visit(child)
      else if (entry.isFile() && entry.name.endsWith('.d.ts')) chunks.push(await readFile(child, 'utf8'))
    }
  }
  await visit(join(path, 'lib', 'types'))
  return chunks.join('\n')
}

function requireText(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label} contract no longer contains ${JSON.stringify(needle)}`)
}

const runtime = await runtimeRoot()
const runtimeManifest = JSON.parse(await readFile(join(runtime, 'package.json'), 'utf8'))
const dshVersion = runtimeManifest.dependencies?.['@deepseek-ai/dsh']
if (dshVersion !== EXPECTED_DSH_VERSION) {
  throw new Error(`this release validates DSH ${EXPECTED_DSH_VERSION}; runtime declares ${String(dshVersion)}`)
}

const workspacePaths = await packageRoots(runtime, '@deepseek-ai/dsh-workspace')
for (const workspacePath of workspacePaths) {
  const workspaceEntryPath = join(workspacePath, 'lib', 'index.js')
  const workspaceEntry = await readFile(workspaceEntryPath)
  const workspaceEntryHash = createHash('sha256').update(workspaceEntry).digest('hex')
  if (workspaceEntryHash !== EXPECTED_WORKSPACE_BUNDLE_SHA256) {
    throw new Error(`workspace package bytes do not match the audited DSH ${EXPECTED_DSH_VERSION} release: ${workspacePath}`)
  }
  const workspaceModule = await import(pathToFileURL(workspaceEntryPath).href)
  const registryProbe = Object.create(workspaceModule.WorkspaceRegistry.prototype)
  if (!matchesAlpha2CompatibilityRegistry(registryProbe)) {
    throw new Error(`workspaceRegistry private method fingerprints do not match the audited alpha.2 adapter: ${workspacePath}`)
  }
}

const settingsPaths = await packageRoots(runtime, '@deepseek-ai/dsh-client-ui-settings')
const workspaceClientPaths = await packageRoots(runtime, '@deepseek-ai/dsh-client-ui-workspace')
const workspaceApiPaths = await packageRoots(runtime, '@deepseek-ai/dsh-api-workspace-controller')
const queryPaths = await packageRoots(runtime, '@deepseek-ai/dsh-session-query')
const webServerPaths = await packageRoots(runtime, '@deepseek-ai/dsh-host-webserver')
for (const path of settingsPaths) {
  const text = await allTypeText(path)
  requireText(text, "'settings.section'", `settings Slot (${path})`)
  requireText(text, 'SettingsSectionOwnerProps', `settings owner props (${path})`)
}
for (const path of workspaceClientPaths) {
  const text = await allTypeText(path)
  requireText(text, 'interface GlobalStandardProps', `global Slot props (${path})`)
  requireText(text, 'useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>', `useWorkspaces Slot prop (${path})`)
}
for (const path of workspaceApiPaths) {
  const text = await allTypeText(path)
  requireText(text, 'export interface WorkspaceSnapshot', `workspace client snapshot (${path})`)
  requireText(text, "readonly archivedSessionIds: WorkspaceArchiveValue['archivedSessionIds']", `archive list state (${path})`)
}
for (const path of queryPaths) {
  const text = await allTypeText(path)
  requireText(text, 'readTitleSnapshots(', `sessionQuery (${path})`)
  requireText(text, "status: 'fulfilled'", `sessionQuery title result (${path})`)
  requireText(text, 'value: SessionTitleObservation', `sessionQuery title observation (${path})`)
}
for (const path of webServerPaths) {
  const text = await allTypeText(path)
  requireText(text, 'register(route: WebRoute): () => void', `webServer disposer (${path})`)
  requireText(text, "export type WebRouteKind = 'exact' | 'prefix'", `exact WebRoute kind (${path})`)
  requireText(text, 'kind: WebRouteKind', `WebRoute kind (${path})`)
  requireText(text, 'handler: (req: IncomingMessage, res: ServerResponse)', `WebRoute handler (${path})`)
}

console.log(`runtime contract verified: DSH ${dshVersion}`)
console.log(`workspaceRegistry alpha.2 package bytes and method fingerprints verified: ${workspacePaths.join(', ')}`)
console.log(`public Slot/service contracts verified for ${root}`)
