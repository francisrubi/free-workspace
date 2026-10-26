// Git awareness: branch in the header, new worktree from a chosen base, the terminal menu
// (explorer in its folder / other worktrees, lazygit) and the explorer node.
const fs = require('fs')
const path = require('path')
const harness = require('./harness.cjs')

module.exports = async (win) => {
  const t = harness(win)
  const { S, js, check, sleep, waitFor, key, type, clickText } = t
  await t.start()
  await t.openWorkspace('Teste')

  check('cabeçalho do terminal mostra a branch', await waitFor(`document.querySelector('.react-flow__node[data-id="g1"] .fw-node-title')?.textContent.includes('⎇ main')`, 8000))

  // New terminal in a fresh worktree, started from a chosen branch.
  await clickText('.fw-toolbar button', 'Terminal')
  await sleep(300)
  await js(`[...document.querySelectorAll('.fw-modal .fw-check')].find(l => l.textContent.includes('worktree')).querySelector('input').click()`)
  await sleep(200)
  await js(`document.querySelector('.fw-modal input[placeholder^="ex.: feat"]').focus()`)
  await type('feat/e2e')
  const listed = await waitFor(`(() => { const o = [...document.querySelectorAll('#fw-branches option')].map(o => o.value); return o.includes('main') && o.includes('base-e2e') })()`, 5000)
  const baseInput = '.fw-modal input[list="fw-branches"]'
  check('origem da worktree lista as branches e vem com a atual', listed && (await js(`document.querySelector('${baseInput}').value`)) === 'main')
  await js(`document.querySelector('${baseInput}').focus()`)
  await key('A', ['control'])
  await type('base-e2e')
  await clickText('.fw-modal button', 'Criar')
  const wtNode = await waitFor(`[...document.querySelectorAll('.fw-node-title')].some(x => x.textContent.includes('⎇ feat/e2e (worktree)'))`, 10000)
  const wt = path.join(S, 'repo.worktrees', 'feat-e2e')
  check('worktree nova parte da origem escolhida', fs.existsSync(path.join(wt, 'base.txt')))
  check('terminal em worktree nova: pasta criada e branch no cabeçalho', wtNode && fs.existsSync(path.join(wt, 'README.md')), await js(`document.querySelector('.fw-modal-error')?.textContent || ''`))

  // Terminal menu: explorer in its folder and in the other worktrees; lazygit.
  await sleep(500) // git info refresh after the worktree was created
  await t.contextMenuOn('.react-flow__node[data-id="g1"] .fw-node-header')
  await sleep(200)
  const items = await js(`[...document.querySelectorAll('.fw-menu button')].map(b => b.textContent.trim())`)
  check('menu do terminal oferece explorador na pasta, na worktree e o lazygit',
    items.some((x) => x.includes('Explorador nesta pasta')) && items.some((x) => x.includes('feat/e2e (worktree)')) && items.some((x) => x.includes('lazygit')), items.join(' | '))
  await clickText('.fw-menu button', 'feat/e2e (worktree)')
  check('explorador abre na pasta da worktree', await waitFor(`[...document.querySelectorAll('.react-flow__node-explorer .fw-node-title')].some(x => x.textContent.includes('feat-e2e'))`, 3000))
  await t.menu('g1', 'lazygit')
  const lazy = await waitFor(`!!document.querySelector('.fw-notice') || [...document.querySelectorAll('.react-flow__node-terminal .fw-node-title')].some(x => x.textContent.startsWith('lazygit'))`, 5000)
  const notice = await js(`document.querySelector('.fw-notice .fw-command')?.textContent || ''`)
  check('lazygit abre (ou explica como instalar)', lazy, notice || 'lazygit instalado: terminal aberto')
  if (notice) await clickText('.fw-notice button', 'Ok')

  // Explorer node.
  const x1 = '.react-flow__node[data-id="x1"]'
  const rows = () => js(`[...document.querySelectorAll('${x1} .fw-tree-row')].map(r => r.textContent.replace(/^[▸▾]/, '').trim())`)
  await waitFor(`[...document.querySelectorAll('${x1} .fw-tree-row')].some(r => r.textContent.includes('README.md'))`, 5000)
  const rows0 = await rows()
  check('explorador lista a pasta (pastas primeiro, sem .git)', rows0[0] === 'src' && rows0.includes('README.md') && !rows0.includes('.git'), rows0.join(','))
  const clickRow = (name) => js(`[...document.querySelectorAll('${x1} .fw-tree-row')].find(r => r.textContent.replace(/^[▸▾]/, '').trim() === ${JSON.stringify(name)}).click()`)
  const readmeNodes = `[...document.querySelectorAll('.react-flow__node-file .fw-node-title')].filter(x => x.textContent.startsWith('README.md')).length`
  await clickRow('README.md')
  const openedFile = await waitFor(`${readmeNodes} === 1`, 5000)
  await sleep(300)
  await clickRow('README.md')
  await sleep(500)
  check('clicar num arquivo abre no canvas, sem duplicar ao clicar de novo', openedFile && (await js(readmeNodes)) === 1)
  await clickRow('src')
  check('expandir pasta carrega o conteúdo', await waitFor(`[...document.querySelectorAll('${x1} .fw-tree-row')].some(r => r.textContent.trim() === 'a.ts')`, 5000))
  await js(`document.querySelector('${x1} .fw-explorer-filter').focus()`)
  await type('a.ts')
  await sleep(300)
  const filtered = await rows()
  check('filtro mostra o caminho relativo dos arquivos encontrados', filtered.length === 1 && /^src[\\/]a\.ts$/.test(filtered[0]), filtered.join(','))
  await sleep(800)
  const saved = t.canvasFile('test').nodes.find((n) => n.id === 'x1')
  check('pastas abertas ficam salvas no nó', (saved.data.open ?? []).some((p) => p.endsWith('src')), JSON.stringify(saved.data.open))
}
