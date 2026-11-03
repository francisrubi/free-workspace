// Runs the e2e modules against the built app (`npm run test:e2e` builds first):
//
//   node test/e2e/run.mjs              all modules
//   node test/e2e/run.mjs git layout   only those
//
// Each module gets its own throwaway data dir and app launch, so they don't depend on each
// other. FW_E2E_EXE="<path to the .exe>" tests a packaged build; FW_E2E_REAL=1 adds a step with
// the real Claude Code CLI to `sessions` (spends a few tokens).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
import { repo, session, terminal, workspace } from './seed.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// A terminal that prints its PID, then a counter: shows whether a process survived.
const TICKER = 'Write-Output "PID=$PID"; $i=0; while ($true) { $i++; Write-Output "TICK-$i"; Start-Sleep -Milliseconds 300 }'

const MODULES = {
  canvas: {
    seed(dir) {
      writeFileSync(path.join(dir, 'renametest.txt'), 'conteudo\n')
      workspace(dir, 'test', 'Teste', {
        nodes: [
          terminal('t1', 'Terminal', dir, 'echo ABCDEFGHIJ0123456789', { width: 900, height: 500 }),
          { id: 'f1', type: 'file', position: { x: 1000, y: 0 }, width: 500, height: 300, data: { path: path.join(dir, 'renametest.txt') } },
          { id: 'n1', type: 'note', position: { x: 1000, y: 400 }, width: 380, height: 260, data: { text: '# Nota' } },
          // More output than fits, for the "grow the node" duplication check.
          terminal('t2', 'Resize', dir, '1..40 | % { "MARK-$_" }', { position: { x: 1700, y: 0 }, width: 520, height: 200 })
        ]
      })
      workspace(dir, 'other', 'Outro', { nodes: [{ id: 'n-other', type: 'note', position: { x: 2000, y: 2000 }, width: 300, height: 200, data: { text: 'OUTRO' } }] })
    }
  },
  sessions: {
    env: { FW_CLAUDE_BIN: 'echo claude' },
    seed(dir) {
      const r = repo(dir)
      r.git('worktree', 'add', '-b', 'feat/e2e', path.join(dir, 'repo.worktrees', 'feat-e2e'))
      const AI = '11111111-1111-4111-8111-111111111111'
      const B = '44444444-4444-4444-8444-444444444444'
      workspace(
        dir,
        'test',
        'Teste',
        {
          nodes: [
            session(AI, 'Claude', r.path, 'CLAUDE_CMD', { role: 'papel do front', sessionId: '22222222-2222-4222-8222-222222222222' }, { width: 900 }),
            session('55555555-5555-4555-8555-555555555555', 'Revisor', dir, 'C_CMD', {}, { position: { x: 1000, y: 0 } }),
            session(B, 'Backend', dir, 'B_CMD', { role: 'cuida da API' }, { position: { x: 1000, y: 400 } }),
            // claude started by hand in a plain terminal, to convert into a session
            terminal('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Manual', dir, 'echo claude --effort medium', { position: { x: 0, y: 400 }, height: 200 })
          ],
          edges: [{ id: 'e1', source: AI, target: B, sourceHandle: 'r', targetHandle: 'l' }]
        },
        { cwd: r.path }
      )
    }
  },
  features: {
    env: { FW_CLAUDE_BIN: 'echo claude' },
    seed(dir) {
      const SESSION = '11111111-1111-4111-8111-111111111111'
      writeFileSync(path.join(dir, 'watch.txt'), 'versao 1\n')
      writeFileSync(path.join(dir, 'pinned.txt'), 'fixado\n')
      // The test's server port replaces PORT at run time.
      writeFileSync(
        path.join(dir, 'api.http'),
        '@base = http://127.0.0.1:PORT\n@token = abc\n\n### Listar\nGET {{base}}/items\nAuthorization: Bearer {{token}}\n\n###\n# @name criar\nPOST {{base}}/items\nContent-Type: application/json\n\n{"nome": "x"}\n\n### Quebrada\nGET {{base}}/{{naoExiste}}\n'
      )
      const ws = workspace(dir, 'test', 'Teste', {
        nodes: [
          terminal('held', 'Parado', dir, 'echo HELD_CMD', { data: { started: true } }),
          terminal('fresh', 'Novo', dir, 'echo FRESH_CMD', { position: { x: 700, y: 0 } }),
          terminal('incmd', 'Cmd', dir, 'echo SHELL=%COMSPEC%', { position: { x: 1400, y: 0 }, data: { shell: 'cmd.exe' } }),
          { id: 'f1', type: 'file', position: { x: 0, y: 400 }, width: 600, height: 300, data: { path: path.join(dir, 'watch.txt') } },
          { id: 'http', type: 'file', position: { x: 700, y: 400 }, width: 600, height: 500, data: { path: path.join(dir, 'api.http') } },
          session(SESSION, 'Sessao', dir, 'S_CMD', { started: false }, { position: { x: 1400, y: 400 }, height: 400 }),
          // Below the spot where the session opens its pinned file, which would cover their dots.
          { id: 'n1', type: 'note', position: { x: 2100, y: 1000 }, width: 300, height: 200, data: { text: '# Plano\n\npasso 1' } },
          { id: 'n2', type: 'note', position: { x: 2100, y: 1300 }, width: 300, height: 200, data: { text: '# Solta' } },
          { id: 'td', type: 'todo', position: { x: 2500, y: 1000 }, width: 300, height: 300, data: { title: 'Lista', items: [{ id: 'i1', text: 'revisar', done: false }, { id: 'i2', text: 'testar', done: true }] } }
        ],
        edges: [
          { id: 'e1', source: SESSION, target: 'n1', sourceHandle: 'r', targetHandle: 'l' },
          { id: 'e2', source: SESSION, target: 'td', sourceHandle: 'r', targetHandle: 'l' }
        ]
      })
      writeFileSync(path.join(ws, '..', '..', 'settings.json'), JSON.stringify({ autoRestart: false }))
    }
  },
  filetypes: {
    seed(dir) {
      const write = (name, text) => writeFileSync(path.join(dir, name), text)
      write('doc.md', '# Titulo MD\n\n<img src="x" onerror="window.__xss = true">\n\n[fora](https://exemplo.test/a) [local](outro.md)\n')
      write('dados.json', '{"id":12345678901234567890,"b":1,"2":[1,{"x":null}],"vazio":{},"texto":"a:b,{c}"}')
      write('ruim.json', '{ // comentario\n"a": 1 }')
      write('package.json', '{\n  "name": "x",\n  "scripts": {\n    "ola": "echo SAIDA_SCRIPT",\n    "$(perigo)": "echo nao"\n  },\n  "other": {\n    "naoscript": "1"\n  }\n}\n')
      write('tarefa.ps1', 'Write-Output "SAIDA_PS1"\n')
      write('tarefa.bat', '@echo SAIDA_BAT\n')
      write('tarefa.sh', 'echo SAIDA_SH\n')
      write('pagina.html', '<h1>oi</h1>\n')
      write('muda.txt', 'linha igual\nminha linha\n')
      const file = (id, name, x, y) => ({ id, type: 'file', position: { x, y }, width: 500, height: 260, data: { path: path.join(dir, name) } })
      workspace(dir, 'test', 'Teste', {
        nodes: [
          file('md', 'doc.md', 0, 0),
          file('json', 'dados.json', 600, 0),
          file('ruim', 'ruim.json', 1200, 0),
          file('pkg', 'package.json', 0, 400),
          file('ps1', 'tarefa.ps1', 600, 400),
          file('bat', 'tarefa.bat', 1200, 400),
          file('sh', 'tarefa.sh', 0, 800),
          file('html', 'pagina.html', 600, 800),
          file('muda', 'muda.txt', 1200, 800)
        ]
      })
    }
  },
  git: {
    seed(dir) {
      const r = repo(dir)
      workspace(
        dir,
        'test',
        'Teste',
        {
          nodes: [
            terminal('g1', 'Repo', r.path, 'echo G1'),
            { id: 'x1', type: 'explorer', position: { x: 700, y: 0 }, width: 320, height: 520, data: { root: r.path } }
          ]
        },
        { cwd: r.path }
      )
    }
  },
  sidebar: {
    seed(dir) {
      workspace(dir, 'test', 'Teste')
      workspace(dir, 'other', 'Outro')
      // Trash: one past the retention (purged at startup), one recent (kept).
      for (const [id, days] of [['velho', 30], ['recente', 1]])
        workspace(dir, id, id, undefined, { deletedAt: new Date(Date.now() - days * 86_400_000).toISOString() })
    }
  },
  layout: {
    seed(dir) {
      workspace(dir, 'origin', 'Origem', {
        nodes: [
          terminal('aaaaaaaa-0000-4000-8000-000000000001', 'Um', dir, TICKER),
          terminal('aaaaaaaa-0000-4000-8000-000000000002', 'Dois', dir, TICKER, { position: { x: 0, y: 400 } }),
          terminal('bbbbbbbb-0000-4000-8000-000000000001', 'API', dir, TICKER, { position: { x: 700, y: 0 }, width: 500, height: 260, data: { color: '#ff0000' } }),
          terminal('bbbbbbbb-0000-4000-8000-000000000002', 'Front', dir, 'echo FRONT', { position: { x: 700, y: 400 }, width: 500, height: 260, data: { color: '#00ff00' } }),
          { id: 'bbbbbbbb-0000-4000-8000-000000000003', type: 'note', position: { x: 1300, y: 0 }, width: 360, height: 260, data: { text: '# Notas' } }
        ]
      })
      workspace(dir, 'dest', 'Destino')
      workspace(dir, 'standby', 'Parado')
    }
  },
  close: {
    timeout: 60_000,
    seed(dir) {
      workspace(dir, 'test', 'Teste', {
        nodes: [0, 1, 2].map((i) => terminal(`t${i}`, `T${i}`, dir, TICKER, { position: { x: i * 650, y: 0 } }))
      })
    },
    // What only the runner can see: did the process end, and was the last change saved.
    after(dir, run) {
      const read = (f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'))
      const errors = existsSync(path.join(dir, 'close-errors.json')) ? read('close-errors.json') : ['o script de teste não rodou']
      const hung = run.error?.code === 'ETIMEDOUT'
      let saved = false
      try {
        saved = read('fwdata/workspaces/test/canvas.json').nodes.length === read('close-state.json').before + 1
      } catch {}
      return [
        { status: errors.length ? 'FAIL' : 'PASS', name: 'fechar o app com terminais rodando não gera erro', extra: errors[0]?.split('\n')[0] ?? '' },
        { status: hung ? 'FAIL' : 'PASS', name: 'o processo do app termina depois de fechar a janela', extra: hung ? 'ainda rodando após 60s' : '' },
        { status: saved ? 'PASS' : 'FAIL', name: 'mudança feita logo antes de fechar é salva', extra: '' }
      ]
    }
  }
}

const wanted = process.argv.slice(2)
const unknown = wanted.filter((m) => !MODULES[m])
if (unknown.length) {
  console.error(`módulo(s) desconhecido(s): ${unknown.join(', ')}. Disponíveis: ${Object.keys(MODULES).join(', ')}`)
  process.exit(2)
}
// Set when launched from VS Code's extension host; Electron would start as plain Node (even if empty).
const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env
const exe = process.env.FW_E2E_EXE

const summary = []
for (const name of wanted.length ? wanted : Object.keys(MODULES)) {
  const mod = MODULES[name]
  const dir = mkdtempSync(path.join(tmpdir(), `fw-e2e-${name}-`))
  mod.seed(dir)
  console.log(`\n▶ ${name}  (${dir})`)
  const started = Date.now()
  const run = spawnSync(exe || electron, exe ? [] : ['.'], {
    cwd: root,
    stdio: 'inherit',
    timeout: mod.timeout ?? 5 * 60_000,
    env: { ...env, ...mod.env, FW_DATA_DIR: path.join(dir, 'fwdata'), FW_E2E_DIR: dir, FW_TEST: path.join(root, 'test', 'e2e', `${name}.cjs`) }
  })
  const file = path.join(dir, 'results.json')
  const results = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
  if (mod.after) for (const r of mod.after(dir, run)) (console.log(`${r.status}  ${r.name}${r.extra ? '  — ' + r.extra : ''}`), results.push(r))
  // A module that stops early (a script error) shows up as a failure, not as "all passed".
  if (run.status !== 0 && !mod.after && !results.some((r) => r.status === 'FAIL'))
    results.push({ status: 'FAIL', name: 'o módulo terminou com erro', extra: run.error?.message ?? `código ${run.status}` })
  summary.push({ name, results, seconds: Math.round((Date.now() - started) / 1000) })
}

console.log('\n── resumo ──')
for (const { name, results, seconds } of summary) {
  const n = (s) => results.filter((r) => r.status === s).length
  console.log(`${name.padEnd(9)} ${String(n('PASS')).padStart(3)} ok  ${n('FAIL')} falha(s)  ${n('SKIP')} pulado(s)  ${seconds}s`)
  for (const r of results.filter((r) => r.status === 'FAIL')) console.log(`   FAIL ${r.name}${r.extra ? ' — ' + r.extra : ''}`)
}
process.exit(summary.some((m) => m.results.some((r) => r.status === 'FAIL')) ? 1 : 0)
