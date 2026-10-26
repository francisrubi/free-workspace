// Sidebar: workspace groups (create, drag in, reorder, collapse, color, delete) and the trash
// (scheduled purge, move to trash, restore, delete now).
const fs = require('fs')
const path = require('path')
const harness = require('./harness.cjs')

module.exports = async (win) => {
  const t = harness(win)
  const { S, js, check, sleep, key, type, click, clickText } = t
  const sidebarFile = () => JSON.parse(fs.readFileSync(path.join(S, 'fwdata', 'sidebar.json'), 'utf8'))
  const wsDir = (id) => path.join(S, 'fwdata', 'workspaces', id)
  await t.start()

  check('lixeira vencida é apagada ao abrir o app (e a recente fica)', !fs.existsSync(wsDir('velho')) && fs.existsSync(wsDir('recente')))

  // HTML5 drag & drop through DOM events sharing one DataTransfer (what the handlers read).
  const dnd = (srcSel, dstSel, yFrac = 0.5) =>
    js(`(() => { const src = document.querySelector(${JSON.stringify(srcSel)}), dst = document.querySelector(${JSON.stringify(dstSel)})
      const dt = new DataTransfer(), r = dst.getBoundingClientRect()
      const at = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + 10, clientY: r.y + r.height * ${yFrac} }
      src.dispatchEvent(new DragEvent('dragstart', at))
      dst.dispatchEvent(new DragEvent('dragover', at))
      dst.dispatchEvent(new DragEvent('drop', at))
      src.dispatchEvent(new DragEvent('dragend', at)) })()`)
  await clickText('.fw-sidebar-actions button', 'grupo')
  await sleep(200)
  await key('A', ['control'])
  await type('Projetos')
  await key('Return')
  await sleep(300)
  check('criar e nomear um grupo', (await js(`document.querySelector('.fw-group-name')?.textContent`)) === 'Projetos')
  await dnd('[data-ws="test"]', '.fw-group-head')
  await sleep(200)
  await dnd('[data-ws="other"]', '.fw-group [data-ws="test"]', 0.2)
  await sleep(500)
  const inGroup = await js(`[...document.querySelectorAll('.fw-group [data-ws]')].map(b => b.dataset.ws).join(',')`)
  const gid = sidebarFile().groups[0]?.id
  check('arrastar workspaces para dentro do grupo e reordenar', inGroup === 'other,test' && sidebarFile().members[gid]?.join(',') === 'other,test', inGroup)
  await js(`document.querySelector('.fw-group-name').click()`)
  await sleep(200)
  const collapsed = await js(`({ hidden: !document.querySelector('.fw-group [data-ws]'), count: document.querySelector('.fw-group-count').textContent })`)
  await js(`document.querySelector('.fw-group-name').click()`)
  await sleep(200)
  check('recolher e expandir o grupo', collapsed.hidden && collapsed.count === '2' && !!(await js(`document.querySelector('.fw-group [data-ws="test"]')`)), JSON.stringify(collapsed))
  await t.setInput('.fw-group-head input[type="color"]', '#ff9e64')
  await sleep(400)
  check('trocar a cor do grupo', sidebarFile().groups[0].color === '#ff9e64')
  await t.contextMenuOn('.fw-group-head')
  await sleep(200)
  await clickText('.fw-menu button', 'Excluir grupo')
  await sleep(400)
  check('excluir o grupo devolve os workspaces à lista', !(await js(`!!document.querySelector('.fw-group')`)) && !!(await js(`document.querySelector('[data-ws="test"]')`)) && sidebarFile().groups.length === 0)

  // Trash.
  const wsButton = (name) => `[...document.querySelectorAll('.fw-ws')].find(b => b.textContent.trim().endsWith(${JSON.stringify(name)}) && !b.closest('.fw-trash-item'))`
  const rightClickWs = async (name) => {
    const r = await js(`(() => { const r = ${wsButton(name)}.getBoundingClientRect(); return { x: r.x, y: r.y, h: r.height } })()`)
    await click(r.x + 30, r.y + r.h / 2, 'right')
    await sleep(200)
  }
  await rightClickWs('Outro')
  await clickText('.fw-menu button', 'Excluir')
  await sleep(200)
  await clickText('.fw-modal button', 'Mover para a lixeira')
  await sleep(500)
  const trashed = JSON.parse(fs.readFileSync(path.join(wsDir('other'), 'workspace.json'), 'utf8'))
  check('mover para a lixeira tira da lista e mantém os arquivos', !(await js(`!!${wsButton('Outro')}`)) && !!trashed.deletedAt && fs.existsSync(path.join(wsDir('other'), 'canvas.json')))
  await clickText('.fw-trash-head', 'Lixeira')
  await sleep(200)
  await js(`[...document.querySelectorAll('.fw-trash-item')].find(i => i.textContent.includes('Outro')).querySelector('button[title="Restaurar"]').click()`)
  await sleep(400)
  check('restaurar da lixeira devolve à lista', await js(`!!${wsButton('Outro')}`))
  await rightClickWs('Outro')
  await clickText('.fw-menu button', 'Excluir')
  await sleep(200)
  await clickText('.fw-modal button', 'Excluir agora')
  await sleep(600)
  check('excluir agora apaga a pasta do workspace', !(await js(`!!${wsButton('Outro')}`)) && !fs.existsSync(wsDir('other')))
}
