import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { matchesRc2CompatibilityRegistry } from '../lib/index.js'

const EXPECTED_DSH_VERSION = '0.1.1-rc.2'
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

async function packageRoot(runtime, name) {
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
  return existing.sort()[0]
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

const workspacePath = await packageRoot(runtime, '@deepseek-ai/dsh-workspace')
const workspaceManifest = JSON.parse(await readFile(join(workspacePath, 'package.json'), 'utf8'))
if (workspaceManifest.version !== EXPECTED_DSH_VERSION) {
  throw new Error(`workspace package is ${workspaceManifest.version}; expected ${EXPECTED_DSH_VERSION}`)
}
const workspaceModule = await import(pathToFileURL(join(workspacePath, 'lib', 'index.js')).href)
const registryProbe = Object.create(workspaceModule.WorkspaceRegistry.prototype)
if (!matchesRc2CompatibilityRegistry(registryProbe)) {
  throw new Error('workspaceRegistry private method fingerprints do not match the audited rc.2 adapter')
}

const settingsText = await allTypeText(await packageRoot(runtime, '@deepseek-ai/dsh-client-ui-settings'))
const layoutText = await allTypeText(await packageRoot(runtime, '@deepseek-ai/dsh-client-ui-layout'))
const queryText = await allTypeText(await packageRoot(runtime, '@deepseek-ai/dsh-session-query'))
const webServerText = await allTypeText(await packageRoot(runtime, '@deepseek-ai/dsh-host-webserver'))
requireText(settingsText, "'settings.section'", 'settings Slot')
requireText(settingsText, 'SettingsSectionOwnerProps', 'settings owner props')
requireText(layoutText, "'shell.overlay'", 'layout Slot')
requireText(queryText, 'readTitleSnapshots(', 'sessionQuery')
requireText(webServerText, 'register(route: WebRoute)', 'webServer')

console.log(`runtime contract verified: DSH ${dshVersion}`)
console.log(`workspaceRegistry rc.2 fingerprint verified: ${workspacePath}`)
console.log(`public Slot/service contracts verified for ${root}`)
