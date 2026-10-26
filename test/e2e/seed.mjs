// Builders for the throwaway data each e2e module starts from.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** A workspace folder with its canvas. */
export function workspace(dir, id, name, canvas = { nodes: [] }, extra = {}) {
  const ws = path.join(dir, 'fwdata', 'workspaces', id)
  mkdirSync(path.join(ws, 'assets'), { recursive: true })
  writeFileSync(path.join(ws, 'workspace.json'), JSON.stringify({ id, name, createdAt: '2026-01-01', ...extra }))
  writeFileSync(path.join(ws, 'canvas.json'), JSON.stringify({ viewport: { x: 40, y: 80, zoom: 0.5 }, ...canvas }))
  return ws
}

/**
 * A git repo at <dir>/repo: README.md and src/a.ts on `main`, plus a `base-e2e` branch that
 * adds base.txt (a worktree started from it must contain that file).
 */
export function repo(dir) {
  const r = path.join(dir, 'repo')
  mkdirSync(path.join(r, 'src'), { recursive: true })
  const git = (...args) => execFileSync('git', args, { cwd: r, stdio: 'ignore' })
  const commit = (msg) => git('-c', 'user.name=e2e', '-c', 'user.email=e2e@local', 'commit', '-m', msg)
  git('init', '-b', 'main')
  writeFileSync(path.join(r, 'README.md'), 'e2e\n')
  writeFileSync(path.join(r, 'src', 'a.ts'), 'export const a = 1\n')
  git('add', '.')
  commit('init')
  git('checkout', '-b', 'base-e2e')
  writeFileSync(path.join(r, 'base.txt'), 'base\n')
  git('add', '.')
  commit('base')
  git('checkout', 'main')
  return { path: r, git }
}

export const terminal = (id, title, cwd, command, extra = {}) => ({
  id,
  type: 'terminal',
  position: { x: 0, y: 0 },
  width: 600,
  height: 300,
  ...extra,
  data: { kind: 'shell', title, cwd, command, ...(extra.data ?? {}) }
})

/** A Claude session node whose "CLI" is an echo: tests see the arguments the app appends. */
export const session = (id, title, cwd, echo, data = {}, extra = {}) => ({
  id,
  type: 'terminal',
  position: { x: 0, y: 0 },
  width: 600,
  height: 300,
  ...extra,
  data: { kind: 'ai', provider: 'claude', title, cwd, command: `echo ${echo}`, started: true, ...data }
})
