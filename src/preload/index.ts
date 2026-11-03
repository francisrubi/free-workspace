import { contextBridge, ipcRenderer, webUtils } from 'electron'
import os from 'node:os'

import type { Settings, SidebarLayout } from '../shared/settings'

export type GitInfo = { branch: string; worktree: boolean; root: string; worktrees: { path: string; branch: string }[] }

type CanvasItem =
  | { type: 'file'; path: string }
  | { type: 'note'; text: string; title?: string }
  | { type: 'todo'; title: string; items: string[] }
  | { type: 'terminal'; title: string; cwd?: string; command?: string }
  | { type: 'session'; id: string; title: string; role: string; cwd: string; command: string }
  | { type: 'snippet'; text: string; label?: string }
  | { type: 'pin'; path: string; note?: string }

export type HttpRequest = { method: string; url: string; headers: [string, string][]; body?: string }
export type HttpResponse =
  | { status: number; statusText: string; headers: [string, string][]; body: string; truncated: boolean; ms: number; error?: undefined }
  | { error: string; ms: number; status?: undefined }

export type FileTouched = { path: string; by: string }
// One IPC listener however many file nodes are open (each adds a callback).
const touchedListeners = new Set<(e: FileTouched) => void>()
ipcRenderer.on('file:touched', (_: unknown, e: FileTouched) => touchedListeners.forEach((cb) => cb(e)))

const api = {
  /** Running under test/e2e.cjs: exposes internals the test inspects. */
  isTest: !!process.env.FW_TEST,
  /** The Claude Code command; FW_CLAUDE_BIN lets the e2e test stand in for the real CLI. */
  claudeBin: process.env.FW_CLAUDE_BIN || 'claude',
  /** Windows build number (e.g. 26200), 0 elsewhere. node-pty uses ConPTY on Windows. */
  windowsBuild: process.platform === 'win32' ? Number(os.release().split('.')[2]) || 0 : 0,
  ws: {
    list: () => ipcRenderer.invoke('ws:list'),
    create: (name: string) => ipcRenderer.invoke('ws:create', name),
    update: (id: string, patch: { name?: string; cwd?: string; deletedAt?: string | null }) => ipcRenderer.invoke('ws:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('ws:delete', id) as Promise<void>,
    importImage: (id: string, file: string) => ipcRenderer.invoke('ws:importImage', id, file) as Promise<string>,
    appendNode: (id: string, node: unknown) => ipcRenderer.invoke('ws:appendNode', id, node) as Promise<void>,
    copyAsset: (src: string, toWorkspace: string) => ipcRenderer.invoke('ws:copyAsset', src, toWorkspace) as Promise<string>,
    load: (id: string) => ipcRenderer.invoke('ws:load', id),
    save: (id: string, data: unknown) => ipcRenderer.invoke('ws:save', id, data),
    saveImage: (id: string, bytes: Uint8Array, ext: string) => ipcRenderer.invoke('ws:saveImage', id, bytes, ext)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
    set: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch) as Promise<Settings>
  },
  sidebar: {
    get: () => ipcRenderer.invoke('sidebar:get') as Promise<SidebarLayout>,
    set: (layout: SidebarLayout) => ipcRenderer.invoke('sidebar:set', layout) as Promise<void>
  },
  file: {
    read: (p: string) => ipcRenderer.invoke('file:read', p) as Promise<string>,
    write: (p: string, content: string) => ipcRenderer.invoke('file:write', p, content),
    stat: (p: string) => ipcRenderer.invoke('file:stat', p) as Promise<{ mtimeMs: number; size: number } | null>,
    /** A Claude session's edit tool changed a file (PostToolUse hook). */
    onTouched: (cb: (e: FileTouched) => void) => {
      touchedListeners.add(cb)
      return () => void touchedListeners.delete(cb)
    },
    rename: (from: string, to: string) => ipcRenderer.invoke('file:rename', from, to) as Promise<void>,
    pathOf: (f: File) => webUtils.getPathForFile(f),
    list: (dir: string) => ipcRenderer.invoke('fs:list', dir) as Promise<{ name: string; path: string; dir: boolean }[]>
  },
  http: {
    send: (req: HttpRequest) => ipcRenderer.invoke('http:send', req) as Promise<HttpResponse>
  },
  shell: {
    showInFolder: (p: string) => ipcRenderer.invoke('shell:showInFolder', p),
    openInEditor: (p: string) => ipcRenderer.invoke('shell:openInEditor', p),
    openInBrowser: (p: string) => ipcRenderer.invoke('shell:openInBrowser', p) as Promise<void>,
    openUrl: (url: string) => ipcRenderer.invoke('shell:openUrl', url) as Promise<void>
  },
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
    readText: () => ipcRenderer.invoke('clipboard:readText') as Promise<string>,
    writeAsset: (src: string) => ipcRenderer.invoke('clipboard:writeAsset', src)
  },
  assetPath: (src: string) => ipcRenderer.invoke('asset:path', src) as Promise<string>,
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:openFile') as Promise<string[]>,
    openDir: (defaultPath?: string) => ipcRenderer.invoke('dialog:openDir', defaultPath) as Promise<string | null>
  },
  git: {
    info: (cwd: string) => ipcRenderer.invoke('git:info', cwd) as Promise<GitInfo | null>,
    branches: (repoDir: string, fetch = false) =>
      ipcRenderer.invoke('git:branches', repoDir, fetch) as Promise<{ current: string; branches: string[] }>,
    addWorktree: (repoDir: string, branch: string, base?: string) =>
      ipcRenderer.invoke('git:addWorktree', repoDir, branch, base) as Promise<string>
  },
  /** Claude Code hook events for one node: which conversation is live, and whether it is busy. */
  onAgentEvent: (nodeId: string, cb: (e: { sessionId: string; event: string }) => void) => {
    const l = (_: unknown, e: { sessionId: string; event: string }) => cb(e)
    ipcRenderer.on(`agent:event:${nodeId}`, l)
    return () => void ipcRenderer.removeListener(`agent:event:${nodeId}`, l)
  },
  agents: {
    /** Who exists in a workspace and who is connected to whom (drives the MCP tools). */
    sync: (workspaceId: string, list: { id: string; title: string; role?: string; cwd?: string; peers: string[] }[]) =>
      ipcRenderer.send('agents:sync', workspaceId, list),
    /** A session called a tool on a note/to-do connected to it; answer with elementReply. */
    onElementRequest: (workspaceId: string, cb: (req: { id: string; from: string; tool: string; args: Record<string, unknown> }) => void) => {
      const l = (_: unknown, req: { id: string; from: string; tool: string; args: Record<string, unknown> }) => cb(req)
      ipcRenderer.on(`canvas:element:${workspaceId}`, l)
      return () => void ipcRenderer.removeListener(`canvas:element:${workspaceId}`, l)
    },
    elementReply: (id: string, text: string, isError: boolean) => ipcRenderer.send('agents:elementReply', id, text, isError),
    /** A session started/finished waiting on another one. */
    onActivity: (cb: (a: { from: string; to: string; pending: boolean }) => void) => {
      const l = (_: unknown, a: { from: string; to: string; pending: boolean }) => cb(a)
      ipcRenderer.on('agent:activity', l)
      return () => void ipcRenderer.removeListener('agent:activity', l)
    }
  },
  /** A session asked (MCP canvas tools) to show something on this workspace's canvas. */
  onCanvasOpen: (workspaceId: string, cb: (req: { from: string; item: CanvasItem }) => void) => {
    const l = (_: unknown, req: { from: string; item: CanvasItem }) => cb(req)
    ipcRenderer.on(`canvas:open:${workspaceId}`, l)
    return () => void ipcRenderer.removeListener(`canvas:open:${workspaceId}`, l)
  },
  homedir: () => ipcRenderer.invoke('app:homedir') as Promise<string>,
  hasCommand: (name: string) => ipcRenderer.invoke('app:hasCommand', name) as Promise<boolean>,
  shells: () => ipcRenderer.invoke('app:shells') as Promise<{ label: string; path: string }[]>,
  pty: {
    open: (opts: { id: string; workspaceId: string; cwd?: string; command?: string; hold?: boolean; shell?: string; claude?: { sessionId?: string }; cols: number; rows: number }) =>
      ipcRenderer.invoke('pty:open', opts) as Promise<{ replay: string }>,
    write: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.send('pty:kill', id),
    killWorkspace: (workspaceId: string) => ipcRenderer.send('pty:killWorkspace', workspaceId),
    setWorkspace: (id: string, workspaceId: string) => ipcRenderer.send('pty:setWorkspace', id, workspaceId),
    onData: (id: string, cb: (d: string) => void) => {
      const l = (_: unknown, d: string) => cb(d)
      ipcRenderer.on(`pty:data:${id}`, l)
      return () => void ipcRenderer.removeListener(`pty:data:${id}`, l)
    },
    onExit: (id: string, cb: (code: number) => void) => {
      const l = (_: unknown, c: number) => cb(c)
      ipcRenderer.on(`pty:exit:${id}`, l)
      return () => void ipcRenderer.removeListener(`pty:exit:${id}`, l)
    }
  }
}

export type Api = typeof api
contextBridge.exposeInMainWorld('api', api)
