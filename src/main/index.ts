import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, nativeImage, net, protocol, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as pty from '@lydell/node-pty'
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings'
import { claudeArgs, startAgentServer, syncAgents, type AgentInfo } from './agents'

// Workspaces live in plain folders (canvas.json + assets/) so they stay readable and
// versionable without the app — same idea as an Obsidian vault.
const DATA_DIR = process.env.FW_DATA_DIR || path.join(os.homedir(), '.free-workspace')
const WS_DIR = path.join(DATA_DIR, 'workspaces')

// ---------- settings ----------

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
let settings: Settings = DEFAULT_SETTINGS

ipcMain.handle('settings:get', () => settings)
ipcMain.handle('settings:set', async (_e, patch: Partial<Settings>) => {
  settings = { ...settings, ...patch }
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2))
  return settings
})

protocol.registerSchemesAsPrivileged([
  { scheme: 'fwasset', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#15171c',
    title: 'Free Workspace',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: false }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))

  // FW_TEST=<script.js>: after load, run `module.exports(win)` and quit. Used to drive the real
  // app with trusted input events (see test/e2e.cjs, `npm run test:e2e`).
  const test = process.env.FW_TEST
  if (test) {
    win.webContents.on('console-message', (e) => console.log('[renderer]', e.message))
    win.webContents.once('did-finish-load', async () => {
      try {
        await require(test)(win)
      } catch (e) {
        console.error('[test] failed:', e)
        process.exitCode = 1
      }
      app.exit(Number(process.exitCode ?? 0))
    })
  }
}

// ---------- workspaces ----------

/** `cwd`: default directory for new terminals in this workspace (overrides the global setting). */
/** `deletedAt`: in the trash since then; purged at startup after `settings.trashDays`. */
type WorkspaceMeta = { id: string; name: string; createdAt: string; cwd?: string; deletedAt?: string }

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function listWorkspaces(): Promise<WorkspaceMeta[]> {
  await fs.mkdir(WS_DIR, { recursive: true })
  const dirs = await fs.readdir(WS_DIR, { withFileTypes: true })
  const metas = await Promise.all(
    dirs
      .filter((d) => d.isDirectory())
      .map((d) => readJson<WorkspaceMeta | null>(path.join(WS_DIR, d.name, 'workspace.json'), null))
  )
  return metas.filter((m): m is WorkspaceMeta => !!m).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

async function createWorkspace(name: string): Promise<WorkspaceMeta> {
  // New workspaces start in the configured directory; each one can be changed afterwards.
  const meta: WorkspaceMeta = { id: randomUUID(), name, createdAt: new Date().toISOString() }
  if (settings.workspaceCwd) meta.cwd = settings.workspaceCwd
  const dir = path.join(WS_DIR, meta.id)
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true })
  await fs.writeFile(path.join(dir, 'workspace.json'), JSON.stringify(meta, null, 2))
  return meta
}

ipcMain.handle('ws:list', async () => {
  const list = await listWorkspaces()
  return list.length ? list : [await createWorkspace('Geral')]
})
ipcMain.handle('ws:create', (_e, name: string) => createWorkspace(name))

/** Only a direct child of WS_DIR — the id comes from the renderer and ends up in an rm -rf. */
function workspaceDir(id: string): string {
  const dir = path.resolve(WS_DIR, id)
  if (!/^[\w-]+$/.test(id) || path.dirname(dir) !== path.resolve(WS_DIR)) throw new Error(`workspace inválido: ${id}`)
  return dir
}
// Deleting removes the workspace folder only (canvas, notes, ToDos, pasted prints). Files that
// file/explorer nodes point to live in the user's repos and are never touched.
ipcMain.handle('ws:delete', (_e, id: string) => fs.rm(workspaceDir(id), { recursive: true, force: true }))

async function purgeTrash(): Promise<void> {
  const limit = Date.now() - settings.trashDays * 86_400_000
  for (const ws of await listWorkspaces())
    if (ws.deletedAt && Date.parse(ws.deletedAt) < limit) await fs.rm(workspaceDir(ws.id), { recursive: true, force: true })
}
ipcMain.handle('ws:update', async (_e, id: string, patch: Partial<WorkspaceMeta>) => {
  const file = path.join(WS_DIR, id, 'workspace.json')
  const meta = await readJson<WorkspaceMeta>(file, { id, name: 'Workspace', createdAt: new Date().toISOString() })
  await fs.writeFile(file, JSON.stringify({ ...meta, ...patch, id }, null, 2))
})
// Only a missing file means "empty canvas". A corrupt one must fail loudly: loading it as
// empty would let the autosave overwrite the user's canvas.
ipcMain.handle('ws:load', async (_e, id: string) => {
  try {
    return JSON.parse(await fs.readFile(path.join(WS_DIR, id, 'canvas.json'), 'utf8'))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }
    throw new Error(`canvas.json ilegível (${(e as Error).message})`)
  }
})
ipcMain.handle('ws:save', (_e, id: string, data: unknown) =>
  fs.writeFile(path.join(WS_DIR, id, 'canvas.json'), JSON.stringify(data, null, 2))
)
ipcMain.handle('ws:saveImage', async (_e, id: string, bytes: Uint8Array, ext: string) => {
  const name = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
  const dir = path.join(WS_DIR, id, 'assets')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, name), bytes)
  return `fwasset://${id}/${name}`
})

// ---------- files ----------

// The explorer makes any file one click away: refuse what the text editor can't show.
const MAX_TEXT_FILE = 5 * 1024 * 1024
ipcMain.handle('file:read', async (_e, p: string) => {
  const buf = await fs.readFile(p)
  if (buf.length > MAX_TEXT_FILE) throw new Error(`Arquivo grande demais para o editor (${(buf.length / 1048576).toFixed(1)} MB).`)
  if (buf.subarray(0, 8000).includes(0)) throw new Error('Arquivo binário: não dá para abrir no editor.')
  return buf.toString('utf8')
})
/** One directory level for the explorer node: folders first, then files, by name. */
ipcMain.handle('fs:list', async (_e, dir: string) => {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => e.name !== '.git')
    .map((e) => ({ name: e.name, path: path.join(dir, e.name), dir: e.isDirectory() }))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
})
/** Copies an image from disk into the workspace assets, like a paste. */
ipcMain.handle('ws:importImage', async (_e, id: string, file: string) => {
  const name = `${Date.now()}-${randomUUID().slice(0, 8)}${path.extname(file).toLowerCase()}`
  const dir = path.join(workspaceDir(id), 'assets')
  await fs.mkdir(dir, { recursive: true })
  await fs.copyFile(file, path.join(dir, name))
  return `fwasset://${id}/${name}`
})
ipcMain.handle('file:write', (_e, p: string, content: string) => fs.writeFile(p, content, 'utf8'))
ipcMain.handle('file:rename', async (_e, from: string, to: string) => {
  // fs.rename silently replaces an existing target on Windows; refuse instead.
  if (await fs.stat(to).then(() => true, () => false)) throw new Error(`Já existe: ${to}`)
  await fs.rename(from, to)
})
ipcMain.handle('shell:showInFolder', (_e, p: string) => shell.showItemInFolder(p))
ipcMain.handle('shell:openInEditor', (_e, p: string) => {
  spawn('code', [p], { shell: true, detached: true, stdio: 'ignore' }).unref()
})
ipcMain.handle('clipboard:writeText', (_e, text: string) => clipboard.writeText(text))
ipcMain.handle('clipboard:readText', () => clipboard.readText())
ipcMain.handle('clipboard:writeAsset', (_e, src: string) => {
  const png = nativeImage.createFromPath(assetPath(src)).toPNG()
  return clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
})
ipcMain.handle('asset:path', (_e, src: string) => assetPath(src))

/** `fwasset://<workspace>/<file>` → absolute path inside that workspace's assets/. */
function assetPath(src: string): string {
  const u = new URL(src)
  return path.join(WS_DIR, u.hostname, 'assets', decodeURIComponent(u.pathname))
}

ipcMain.handle('dialog:openFile', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'] })
  return r.canceled ? [] : r.filePaths
})
ipcMain.handle('dialog:openDir', async (_e, defaultPath?: string) => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], defaultPath: defaultPath || undefined })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('app:homedir', () => os.homedir())

// ---------- git ----------
// Read-only awareness plus one creation shortcut. Removing/merging worktrees is deliberately
// left to the terminal: that is where uncommitted work gets lost.

const run = promisify(execFile)
const git = async (cwd: string, ...args: string[]) =>
  (await run('git', args, { cwd, windowsHide: true })).stdout.trim()
const gitError = (e: unknown) => ((e as { stderr?: string }).stderr || (e as Error).message).trim()

ipcMain.handle('git:info', async (_e, cwd: string) => {
  try {
    const [branch, gitDir, commonDir] = (
      await git(cwd, 'rev-parse', '--path-format=absolute', '--abbrev-ref', 'HEAD', '--git-dir', '--git-common-dir')
    ).split(/\r?\n/)
    return { branch: branch === 'HEAD' ? 'HEAD solto' : branch, worktree: path.resolve(gitDir) !== path.resolve(commonDir) }
  } catch {
    return null // not a repository (or no commits yet)
  }
})

/** Creates `<repo>.worktrees/<branch>` next to the main checkout and returns its path. */
ipcMain.handle('git:addWorktree', async (_e, repoDir: string, branch: string) => {
  try {
    await git(repoDir, 'check-ref-format', '--branch', branch)
    const mainRoot = path.dirname(await git(repoDir, 'rev-parse', '--path-format=absolute', '--git-common-dir'))
    const target = path.join(`${mainRoot}.worktrees`, branch.replace(/[\\/]/g, '-'))
    const exists = await git(repoDir, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`).then(() => true, () => false)
    await git(repoDir, 'worktree', 'add', ...(exists ? [target, branch] : ['-b', branch, target]))
    return target
  } catch (e) {
    throw new Error(gitError(e))
  }
})

// ---------- terminals ----------
// PTYs are owned by the main process and keyed by canvas node id, so they keep running
// while you switch workspaces; the renderer re-attaches and gets the scrollback replayed.

type Session = { proc: pty.IPty; buffer: string; exited: boolean; workspaceId: string }
const sessions = new Map<string, Session>()
const MAX_BUFFER = 256 * 1024

function defaultShell(): string {
  if (settings.shell) return settings.shell
  return process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
}

function kill(id: string): void {
  const s = sessions.get(id)
  if (s && !s.exited) s.proc.kill()
  sessions.delete(id)
}

ipcMain.handle(
  'pty:open',
  async (
    _e,
    opts: { id: string; workspaceId: string; cwd?: string; command?: string; claude?: { sessionId?: string }; cols: number; rows: number }
  ) => {
    const existing = sessions.get(opts.id)
    if (existing && !existing.exited) return { replay: existing.buffer }

    const proc = pty.spawn(defaultShell(), [], {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd || settings.terminalCwd || os.homedir(),
      env: process.env as Record<string, string>
    })
    const s: Session = { proc, buffer: '', exited: false, workspaceId: opts.workspaceId }
    sessions.set(opts.id, s)
    // A restart reuses the node id; events from the replaced process must not reach the new one.
    const current = () => sessions.get(opts.id) === s
    proc.onData((d) => {
      s.buffer = (s.buffer + d).slice(-MAX_BUFFER)
      if (current()) win?.webContents.send(`pty:data:${opts.id}`, d)
    })
    proc.onExit(({ exitCode }) => {
      s.exited = true
      if (current()) win?.webContents.send(`pty:exit:${opts.id}`, exitCode)
    })
    const command = opts.command && opts.claude ? opts.command + (await claudeArgs(opts.id, opts.claude.sessionId)) : opts.command
    if (command && current()) proc.write(command + '\r')
    return { replay: '' }
  }
)
ipcMain.on('pty:write', (_e, id: string, data: string) => sessions.get(id)?.proc.write(data))
ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => {
  const s = sessions.get(id)
  if (s && !s.exited && cols > 0 && rows > 0) s.proc.resize(cols, rows)
})
ipcMain.on('pty:kill', (_e, id: string) => kill(id))
ipcMain.on('agents:sync', (_e, workspaceId: string, list: AgentInfo[]) => syncAgents(workspaceId, list))
// Putting a workspace back on stand-by ends its terminals; AI sessions resume on next open.
ipcMain.on('pty:killWorkspace', (_e, workspaceId: string) => {
  for (const [id, s] of sessions) if (s.workspaceId === workspaceId) kill(id)
})

app.whenReady().then(async () => {
  settings = { ...DEFAULT_SETTINGS, ...(await readJson<Partial<Settings>>(SETTINGS_FILE, {})) }
  await purgeTrash().catch((e) => console.error('purge trash:', e))
  await startAgentServer({
    dataDir: DATA_DIR,
    settings: () => settings,
    send: (channel, payload) => win?.webContents.send(channel, payload),
    write: (id, text) => {
      const s = sessions.get(id)
      if (!s || s.exited) return false
      s.proc.write(text)
      return true
    }
  })
  protocol.handle('fwasset', (req) => net.fetch(pathToFileURL(assetPath(req.url)).toString()))
  createWindow()
})

app.on('window-all-closed', () => {
  for (const s of sessions.values()) if (!s.exited) s.proc.kill()
  app.quit()
})
