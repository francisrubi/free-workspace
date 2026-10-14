import { contextBridge, ipcRenderer, webUtils } from 'electron'
import os from 'node:os'

import type { Settings } from '../shared/settings'

type CanvasItem =
  | { type: 'file'; path: string }
  | { type: 'note'; text: string; title?: string }
  | { type: 'todo'; title: string; items: string[] }
  | { type: 'terminal'; title: string; cwd?: string; command?: string }

const api = {
  /** Running under test/e2e.cjs: exposes internals the test inspects. */
  isTest: !!process.env.FW_TEST,
  /** Windows build number (e.g. 26200), 0 elsewhere. node-pty uses ConPTY on Windows. */
  windowsBuild: process.platform === 'win32' ? Number(os.release().split('.')[2]) || 0 : 0,
  ws: {
    list: () => ipcRenderer.invoke('ws:list'),
    create: (name: string) => ipcRenderer.invoke('ws:create', name),
    update: (id: string, patch: { name?: string; cwd?: string; deletedAt?: string | null }) => ipcRenderer.invoke('ws:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('ws:delete', id) as Promise<void>,
    importImage: (id: string, file: string) => ipcRenderer.invoke('ws:importImage', id, file) as Promise<string>,
    load: (id: string) => ipcRenderer.invoke('ws:load', id),
    save: (id: string, data: unknown) => ipcRenderer.invoke('ws:save', id, data),
    saveImage: (id: string, bytes: Uint8Array, ext: string) => ipcRenderer.invoke('ws:saveImage', id, bytes, ext)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
    set: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch) as Promise<Settings>
  },
  file: {
    read: (p: string) => ipcRenderer.invoke('file:read', p) as Promise<string>,
    write: (p: string, content: string) => ipcRenderer.invoke('file:write', p, content),
    rename: (from: string, to: string) => ipcRenderer.invoke('file:rename', from, to) as Promise<void>,
    pathOf: (f: File) => webUtils.getPathForFile(f),
    list: (dir: string) => ipcRenderer.invoke('fs:list', dir) as Promise<{ name: string; path: string; dir: boolean }[]>
  },
  shell: {
    showInFolder: (p: string) => ipcRenderer.invoke('shell:showInFolder', p),
    openInEditor: (p: string) => ipcRenderer.invoke('shell:openInEditor', p)
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
    info: (cwd: string) => ipcRenderer.invoke('git:info', cwd) as Promise<{ branch: string; worktree: boolean } | null>,
    addWorktree: (repoDir: string, branch: string) => ipcRenderer.invoke('git:addWorktree', repoDir, branch) as Promise<string>
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
  pty: {
    open: (opts: { id: string; workspaceId: string; cwd?: string; command?: string; claude?: { sessionId?: string }; cols: number; rows: number }) =>
      ipcRenderer.invoke('pty:open', opts) as Promise<{ replay: string }>,
    write: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.send('pty:kill', id),
    killWorkspace: (workspaceId: string) => ipcRenderer.send('pty:killWorkspace', workspaceId),
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
