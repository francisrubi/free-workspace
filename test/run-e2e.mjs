// Seeds a throwaway workspace (terminal at 50% zoom, a Claude session node, a file to rename)
// plus a small git repo, and runs test/e2e.cjs
// inside the built app. Needs `electron-vite build` first (the npm script does it).
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(path.join(tmpdir(), 'fw-e2e-'))
const ws = path.join(dir, 'fwdata', 'workspaces', 'test')
mkdirSync(path.join(ws, 'assets'), { recursive: true })
writeFileSync(path.join(dir, 'renametest.txt'), 'conteudo\n')
// Repo for the branch badge and the worktree shortcut.
const repo = path.join(dir, 'repo')
mkdirSync(repo)
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
git('init', '-b', 'main')
writeFileSync(path.join(repo, 'README.md'), 'e2e\n')
mkdirSync(path.join(repo, 'src'))
writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1\n')
git('add', '.')
git('-c', 'user.name=e2e', '-c', 'user.email=e2e@local', 'commit', '-m', 'init')
// A second branch with its own file: a worktree started from it must contain base.txt.
git('checkout', '-b', 'base-e2e')
writeFileSync(path.join(repo, 'base.txt'), 'base\n')
git('add', '.')
git('-c', 'user.name=e2e', '-c', 'user.email=e2e@local', 'commit', '-m', 'base')
git('checkout', 'main')

// The "Claude" node runs `echo` instead of the real CLI: the test only needs to see which
// arguments the app appends, and then plays the hooks itself.
const AI_NODE = '11111111-1111-4111-8111-111111111111'
const OLD_SESSION = '22222222-2222-4222-8222-222222222222'
writeFileSync(path.join(ws, 'workspace.json'), JSON.stringify({ id: 'test', name: 'Teste', createdAt: '2026-01-01', cwd: repo }))
writeFileSync(
  path.join(ws, 'canvas.json'),
  JSON.stringify({
    viewport: { x: 40, y: 80, zoom: 0.5 },
    nodes: [
      { id: 't1', type: 'terminal', position: { x: 0, y: 0 }, width: 900, height: 500,
        data: { kind: 'shell', title: 'Terminal', cwd: dir, command: 'echo ABCDEFGHIJ0123456789' } },
      { id: 'f1', type: 'file', position: { x: 1000, y: 0 }, width: 500, height: 300,
        data: { path: path.join(dir, 'renametest.txt') } },
      { id: AI_NODE, type: 'terminal', position: { x: 0, y: 560 }, width: 900, height: 300,
        data: { kind: 'ai', provider: 'claude', title: 'Claude', role: 'papel do front', cwd: repo, command: 'echo CLAUDE_CMD', started: true, sessionId: OLD_SESSION } },
      // B is connected to the node above; C is not (the test connects it by dragging).
      { id: '44444444-4444-4444-8444-444444444444', type: 'terminal', position: { x: 1000, y: 760 }, width: 600, height: 300,
        data: { kind: 'ai', provider: 'claude', title: 'Backend', role: 'cuida da API', cwd: dir, command: 'echo B_CMD', started: true } },
      { id: '55555555-5555-4555-8555-555555555555', type: 'terminal', position: { x: 1000, y: 400 }, width: 600, height: 300,
        data: { kind: 'ai', provider: 'claude', title: 'Revisor', cwd: dir, command: 'echo C_CMD', started: true } },
      // Small terminal with more output than fits, for the "grow the node" duplication check.
      { id: 't2', type: 'terminal', position: { x: 1700, y: 0 }, width: 520, height: 200,
        data: { kind: 'shell', title: 'Resize', cwd: dir, command: '1..40 | % { "MARK-$_" }' } },
      { id: 'x1', type: 'explorer', position: { x: 2300, y: 0 }, width: 320, height: 520, data: { root: repo } }
    ],
    edges: [{ id: 'e1', source: AI_NODE, target: '44444444-4444-4444-8444-444444444444', sourceHandle: 'r', targetHandle: 'l' }]
  })
)

// A second workspace, to check that switching hides the first one's nodes.
const other = path.join(dir, 'fwdata', 'workspaces', 'other')
mkdirSync(path.join(other, 'assets'), { recursive: true })
writeFileSync(path.join(other, 'workspace.json'), JSON.stringify({ id: 'other', name: 'Outro', createdAt: '2026-01-02' }))
writeFileSync(
  path.join(other, 'canvas.json'),
  JSON.stringify({ viewport: { x: 0, y: 0, zoom: 1 }, nodes: [{ id: 'n-other', type: 'note', position: { x: 2000, y: 2000 }, width: 300, height: 200, data: { text: 'OUTRO' } }] })
)

// Set when launched from VS Code's extension host; Electron would start as plain Node (even if empty).
const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env

// Trash: one past the retention (purged at startup), one recent (kept).
for (const [id, days] of [['velho', 30], ['recente', 1]]) {
  const d = path.join(dir, 'fwdata', 'workspaces', id)
  mkdirSync(d, { recursive: true })
  const deletedAt = new Date(Date.now() - days * 86_400_000).toISOString()
  writeFileSync(path.join(d, 'workspace.json'), JSON.stringify({ id, name: id, createdAt: '2026-01-03', deletedAt }))
}

// FW_E2E_EXE=<path to the packaged .exe> runs the same checks against a built app.
const exe = process.env.FW_E2E_EXE
const r = spawnSync(exe || electron, exe ? [] : ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...env, FW_DATA_DIR: path.join(dir, 'fwdata'), FW_E2E_DIR: dir, FW_TEST: path.join(root, 'test', 'e2e.cjs') }
})
console.log(`\nscreenshots e dados em ${dir}`)
process.exit(r.status ?? 1)
