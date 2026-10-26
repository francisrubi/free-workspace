// Canvas basics: stand-by, zoom, terminals (resize, selection, clipboard, composer), menus,
// renaming, right-drag, settings, node colors, switching workspaces.
const { clipboard } = require('electron')
const fs = require('fs')
const path = require('path')
const harness = require('./harness.cjs')

module.exports = async (win) => {
  const t = harness(win)
  const { S, js, check, skip, sleep, waitFor, rect, click, drag, key, type, mouse, clickText } = t
  await t.start()

  check('stand-by: nenhum workspace carregado ao abrir', await js(`!!document.querySelector('.fw-empty') && !document.querySelector('.xterm')`))
  await clickText('.fw-ws', 'Teste')
  await t.waitBuffer('t1', 'ABCDEFGHIJ0123456789\n')
  await sleep(300)
  check('abre ao clicar na lista', await js(`!!document.querySelector('.xterm') && !!document.querySelector('.fw-ws-dot.on')`))
  check('indicador de zoom mostra 50%', (await js(`document.querySelector('.fw-zoom-value')?.textContent`)) === '50%')

  // Growing a terminal must not duplicate or lose lines (ConPTY repaints; xterm must not also
  // pull scrollback into the new rows).
  const t2 = '.react-flow__node[data-id="t2"]'
  await t.waitBuffer('t2', 'MARK-40')
  await sleep(500)
  const t2head = await rect(`${t2} .fw-node-title`)
  await click(t2head.x + 10, t2head.y + t2head.h / 2)
  for (let i = 0; i < 3; i++) {
    const h = await rect(`${t2} .react-flow__resize-control.handle.bottom.right`)
    await drag(h.x + h.w / 2, h.y + h.h / 2, h.x + h.w / 2, h.y + h.h / 2 + 60)
    await sleep(600)
  }
  const marks = (await t.bufferText('t2')).split('\n').map((l) => l.trim()).filter((l) => /^MARK-\d+$/.test(l))
  const dupes = [...new Set(marks.filter((m, i) => marks.indexOf(m) !== i))]
  const missing = Array.from({ length: 40 }, (_, i) => `MARK-${i + 1}`).filter((m) => !marks.includes(m))
  check('expandir o terminal não duplica nem perde linhas', !dupes.length && !missing.length, `repetidas: ${dupes.join(',') || 'nenhuma'}; perdidas: ${missing.join(',') || 'nenhuma'}`)

  // Composer under the selected terminal: Shift+Enter breaks the line, Enter sends.
  const comp = `${t2} .fw-composer textarea`
  check('caixa de texto aparece abaixo do terminal selecionado', await waitFor(`!!document.querySelector('${comp}')`, 2000))
  const emptyBox = await js(`(() => { const el = document.querySelector('${comp}'); return { placeholder: el.placeholder, scrolls: el.scrollHeight > el.clientHeight || getComputedStyle(el).overflowY !== 'hidden' } })()`)
  check('caixa vazia sem barra de rolagem e com placeholder curto', emptyBox.placeholder === 'Escreva aqui' && !emptyBox.scrolls, JSON.stringify(emptyBox))
  const cbox = await rect(comp)
  await click(cbox.x + 20, cbox.y + cbox.h / 2)
  await type('echo COMP_A')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return', modifiers: ['shift'] })
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers: ['shift'] })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return', modifiers: ['shift'] })
  await sleep(150)
  await type('echo COMP_B')
  const draft = await js(`document.querySelector('${comp}').value`)
  check('Shift+Enter quebra a linha na caixa', draft === 'echo COMP_A\necho COMP_B', JSON.stringify(draft))
  await key('Return')
  const ran = (await t.waitBuffer('t2', '\nCOMP_A')) && (await t.waitBuffer('t2', '\nCOMP_B'))
  check('Enter envia as duas linhas ao terminal e limpa a caixa', ran && (await js(`document.querySelector('${comp}').value`)) === '')
  await key('Up')
  check('↑ na caixa vazia recupera o último envio', (await js(`document.querySelector('${comp}').value`)) === 'echo COMP_A\necho COMP_B')
  await key('A', ['control'])
  await key('Delete')
  await key('Escape')
  const emptySpot = await js(`(() => { const r = document.querySelector('.fw-canvas').getBoundingClientRect()
    for (let y = r.bottom - 60; y > r.top + 120; y -= 30) for (let x = r.right - 60; x > r.left + 120; x -= 30)
      if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y } })()`)
  await click(emptySpot.x, emptySpot.y)
  check('caixa some ao desselecionar (vazia)', await waitFor(`!document.querySelector('${comp}')`, 2000))

  // Selection at 50% zoom (xterm's mouse→cell math is patched for the canvas scale) + Ctrl+C.
  const pos = await js(`(() => {
    const row = [...document.querySelectorAll('.react-flow__node[data-id="t1"] .xterm-rows > div')].find(r => r.textContent.trim().startsWith('ABCDEFGHIJ'))
    if (!row) return null
    const w = document.createTreeWalker(row, NodeFilter.SHOW_TEXT); let n
    while ((n = w.nextNode())) { const i = n.textContent.indexOf('ABCDEFGHIJ'); if (i >= 0) {
      const rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i + 1); const a = rg.getBoundingClientRect()
      rg.setStart(n, i + 9); rg.setEnd(n, i + 10); const j = rg.getBoundingClientRect()
      return { x1: a.left + 1, x2: j.right - 1, y: a.top + a.height / 2 } } }
  })()`)
  if (!pos) check('linha de saída do terminal encontrada', false)
  else {
    await clipboard.writeText('VAZIO')
    await drag(pos.x1, pos.y, pos.x2, pos.y)
    const selected = await js(`window.__fwTerminals.get('t1').term.getSelection()`)
    check('seleção com zoom 50% pega o texto certo', selected === 'ABCDEFGHIJ', `seleção="${selected}"`)
    await key('C', ['control'])
    await sleep(400)
    const got = await clipboard.readText()
    if (await t.clipboardUsable()) check('Ctrl+C copia a seleção', got === 'ABCDEFGHIJ', `clipboard="${got}"`)
    else skip('Ctrl+C copia a seleção', 'área de transferência em uso por outro programa')
  }

  const canPaste = await t.clipboardUsable()
  await clipboard.writeText('echo PASTED_OK')
  const term = await rect('.react-flow__node[data-id="t1"] .fw-terminal')
  await click(term.x + term.w / 2, term.y + term.h - 20)
  await key('V', ['control'])
  await sleep(300)
  await key('Return')
  const pasted = await t.waitBuffer('t1', '\nPASTED_OK', 8000)
  if (canPaste) check('Ctrl+V cola texto no terminal', pasted)
  else skip('Ctrl+V cola texto no terminal', 'área de transferência em uso por outro programa')

  await clickText('.fw-zoom-value', '%')
  check('clicar no indicador volta para 100%', await waitFor(`document.querySelector('.fw-zoom-value').textContent === '100%'`, 3000))

  // Node menu + rename (deselect first: a selected node's text box could cover a header).
  await key('Escape')
  await js(`document.querySelector('.react-flow__pane').dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await js(`document.querySelector('.react-flow__controls-fitview').click()`)
  await sleep(500)
  const head = await t.stableRect('.react-flow__node[data-id="t1"] .fw-node-title')
  await click(head.x + 20, head.y + head.h / 2, 'right')
  await sleep(200)
  check('menu de contexto do nó abre', await js(`[...document.querySelectorAll('.fw-menu button')].some(b => b.textContent === 'Reiniciar processo')`))
  await clickText('.fw-menu button', 'Renomear')
  await sleep(200)
  await key('A', ['control'])
  await type('Meu Terminal')
  await key('Return')
  await sleep(300)
  check('renomear nó pelo menu', (await js(`document.querySelector('.react-flow__node[data-id="t1"] .fw-node-title').firstChild.textContent`)) === 'Meu Terminal')

  // Renaming a file node renames the file on disk.
  const fhead = await t.stableRect('.react-flow__node-file .fw-node-title')
  const fx = fhead.x + 15
  const fy = fhead.y + fhead.h / 2
  mouse('mouseDown', fx, fy, 'left', 1)
  mouse('mouseUp', fx, fy, 'left', 1)
  mouse('mouseDown', fx, fy, 'left', 2)
  mouse('mouseUp', fx, fy, 'left', 2)
  if (!(await waitFor(`document.activeElement?.matches('.react-flow__node-file .fw-title-input')`, 3000))) check('duplo clique no título abre a edição', false)
  await key('A', ['control'])
  await type('renomeado.txt')
  await key('Return')
  await sleep(600)
  check('renomear arquivo renomeia no disco', fs.existsSync(path.join(S, 'renomeado.txt')) && !fs.existsSync(path.join(S, 'renametest.txt')))

  // Right-drag pans without a menu; a simple right click opens the pane menu.
  const vp = () => js(`document.querySelector('.fw-canvas-slot:not(.fw-hidden) .react-flow__viewport').style.transform`)
  const before = await vp()
  const spot = await js(`(() => {
    const free = (x, y) => document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')
    const r = document.querySelector('.fw-canvas').getBoundingClientRect()
    for (let y = r.bottom - 60; y > r.top + 160; y -= 40)
      for (let x = r.right - 60; x > r.left + 160; x -= 40)
        if (free(x, y) && free(x - 100, y - 60)) return { x, y }
  })()`)
  await drag(spot.x, spot.y, spot.x - 100, spot.y - 60, 'right')
  check('arrastar com botão direito move o canvas', before !== (await vp()))
  check('arrastar com botão direito não abre menu', !(await js(`!!document.querySelector('.fw-menu')`)))
  await click(spot.x, spot.y, 'right')
  await sleep(200)
  check('clique direito simples no canvas abre menu de criação', await js(`[...document.querySelectorAll('.fw-menu button')].some(b => b.textContent.includes('Sessão IA'))`))
  await key('Escape')
  await sleep(150)

  // Settings: minimap off; node colors per kind and per node.
  check('minimapa visível por padrão', await js(`!!document.querySelector('.react-flow__minimap')`))
  await clickText('.fw-ws', 'Configurações')
  await sleep(200)
  await js(`[...document.querySelectorAll('.fw-check')].find(l => l.textContent.includes('minimapa')).querySelector('input').click()`)
  await t.setInput('.fw-color-item[data-kind="terminal"] input[type="color"]', '#ff0000')
  await clickText('.fw-modal button', 'Salvar')
  await sleep(400)
  const settings = JSON.parse(fs.readFileSync(path.join(S, 'fwdata', 'settings.json'), 'utf8'))
  check('desligar minimapa nas configurações', !(await js(`!!document.querySelector('.react-flow__minimap')`)) && settings.showMinimap === false)
  const frameOf = (sel) => js(`(() => { const f = document.querySelector(${JSON.stringify(sel)} + ' .fw-node'); return { colored: f.classList.contains('colored'), color: f.style.getPropertyValue('--node-color') } })()`)
  const t1Frame = await frameOf('.react-flow__node[data-id="t1"]')
  const noteFrame = await frameOf('.react-flow__node[data-id="n1"]')
  check('cor padrão do tipo pinta os terminais (e só eles)', t1Frame.colored && t1Frame.color === '#ff0000' && !noteFrame.colored, JSON.stringify({ t1Frame, noteFrame }))
  await t.menu('n1', 'Cor…')
  await t.setInput('#fw-node-color-picker', '#00ff00')
  await sleep(900)
  check('cor de um nó específico pelo menu (e salva no canvas)',
    (await frameOf('.react-flow__node[data-id="n1"]')).color === '#00ff00' && t.canvasFile('test').nodes.find((n) => n.id === 'n1').data.color === '#00ff00')
  await t.menu('n1', 'Usar a cor padrão')
  await sleep(300)
  check('voltar o nó para a cor padrão do tipo', !(await frameOf('.react-flow__node[data-id="n1"]')).colored)

  // Switching workspace hides the previous one's nodes; each canvas draws its own grid.
  await clickText('.fw-ws', 'Outro')
  await waitFor(`!!document.querySelector('.react-flow__node[data-id="n-other"]')`, 5000)
  await sleep(500)
  const leaks = await js(`(() => { const h = [...document.querySelectorAll('.fw-hidden .react-flow__node')]; return { total: h.length, visible: h.filter(n => getComputedStyle(n).visibility !== 'hidden').length } })()`)
  check('nós do workspace anterior ficam invisíveis ao trocar', leaks.total > 0 && leaks.visible === 0, JSON.stringify(leaks))
  const grids = await js(`(() => { const ids = [...document.querySelectorAll('.react-flow__background pattern')].map(p => p.id); return { canvases: document.querySelectorAll('.react-flow').length, distinct: new Set(ids).size } })()`)
  check('cada canvas tem o próprio fundo pontilhado', grids.canvases === 2 && grids.distinct === 2, JSON.stringify(grids))
  await clickText('.fw-ws', 'Teste')
  await sleep(400)

  // Stand-by from the workspace's menu ("Outro" stays open in the background).
  const ws = await rect('.fw-ws.active')
  await click(ws.x + 30, ws.y + ws.h / 2, 'right')
  await sleep(200)
  await clickText('.fw-menu button', 'stand-by')
  await sleep(400)
  check('colocar em stand-by descarrega o workspace',
    await js(`!!document.querySelector('.fw-empty') && !document.querySelector('.react-flow__node-terminal') && !![...document.querySelectorAll('.fw-ws')].find(b => b.textContent.includes('Teste'))?.querySelector('.fw-ws-dot:not(.on)')`))
}
