// Moving nodes between workspaces (processes keep running) and tab groups.
const harness = require('./harness.cjs')

const T1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const T2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const K1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const K2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const K3 = 'bbbbbbbb-0000-4000-8000-000000000003'

module.exports = async (win) => {
  const t = harness(win)
  const { js, check, sleep, waitFor, drag } = t
  const pidOf = (text) => (text?.match(/PID=(\d+)/) || [])[1]
  const lastTick = (text) => Math.max(0, ...[...(text ?? '').matchAll(/TICK-(\d+)/g)].map((m) => +m[1]))
  const sel = (id) => `.react-flow__node[data-id="${id}"]`
  await t.start()
  await t.openWorkspace('Destino') // loaded, then hidden behind the origin
  await t.openWorkspace('Origem')
  // The echoed command line also contains "PID=$PID": wait for the number itself.
  const waitPid = async (id) => {
    for (let i = 0; i < 60 && !pidOf(await t.bufferText(id)); i++) await sleep(200)
  }
  await waitPid(T1)
  await waitPid(T2)
  const pid1 = pidOf(await t.bufferText(T1))
  const pid2 = pidOf(await t.bufferText(T2))
  await sleep(1200)
  const tick1 = lastTick(await t.bufferText(T1))

  // To a loaded workspace.
  await t.menu(T1, 'Mover para outro workspace')
  await t.waitFor(`!!document.querySelector('.fw-move-list [data-ws="dest"]')`, 3000)
  await js(`document.querySelector('.fw-move-list [data-ws="dest"]')?.click()`)
  await sleep(2000)
  const after1 = await t.bufferText(T1)
  check('mover para workspace aberto: sai da origem e entra no destino',
    !(await js(`!!document.querySelector('.fw-canvas-slot:not(.fw-hidden) ${sel(T1)}')`)) && (await js(`!!document.querySelector('.fw-hidden ${sel(T1)}')`)))
  check('o terminal movido é o mesmo processo e continua rodando', pidOf(after1) === pid1 && lastTick(after1) > tick1, `pid ${pid1} → ${pidOf(after1)}, tick ${tick1} → ${lastTick(after1)}`)

  // To a workspace on stand-by.
  await t.menu(T2, 'Mover para outro workspace')
  await t.waitFor(`!!document.querySelector('.fw-move-list [data-ws="standby"]')`, 3000)
  await js(`document.querySelector('.fw-move-list [data-ws="standby"]')?.click()`)
  await sleep(1500)
  check('mover para workspace em stand-by grava no canvas.json dele', t.canvasFile('standby').nodes.some((n) => n.id === T2))
  await t.openWorkspace('Parado')
  await waitPid(T2)
  await sleep(1000)
  check('ao abrir o stand-by, o terminal reconecta ao mesmo processo', pidOf(await t.bufferText(T2)) === pid2)
  await t.openWorkspace('Origem')
  await sleep(500)
  check('origem salva sem os nós movidos', !t.canvasFile('origin').nodes.some((n) => n.id === T1 || n.id === T2))

  // Tab groups: drop a node by its header onto another's header.
  await js(`document.querySelector('.fw-canvas-slot:not(.fw-hidden) .react-flow__controls-fitview')?.click()`)
  await sleep(600)
  const headerOf = (id) => t.stableRect(`${sel(id)} .fw-node-header`)
  const dragHeader = async (id, ontoId) => {
    const a = await headerOf(id)
    const b = await headerOf(ontoId)
    await drag(a.x + a.w * 0.5, a.y + a.h / 2, b.x + b.w * 0.5, b.y + b.h / 2)
    await sleep(500)
  }
  const tabsIn = (id) => js(`[...document.querySelectorAll('${sel(id)} .fw-tab')].map(x => ({ id: x.dataset.tab, active: x.classList.contains('active'), color: x.style.getPropertyValue('--tab-color') }))`)
  const isHidden = (id) => js(`document.querySelector('${sel(id)}').classList.contains('fw-stack-hidden')`)
  await dragHeader(K2, K1)
  const tabs = await tabsIn(K2)
  check('soltar um cabeçalho sobre outro cria um grupo de abas', tabs.length === 2 && (await isHidden(K1)) && !(await isHidden(K2)), JSON.stringify(tabs))
  check('cada aba mantém a cor do seu elemento', tabs.find((x) => x.id === K1)?.color === '#ff0000' && tabs.find((x) => x.id === K2)?.color === '#00ff00', JSON.stringify(tabs))
  const k1Before = lastTick(await t.bufferText(K1))
  await sleep(1000)
  check('a aba escondida continua rodando', lastTick(await t.bufferText(K1)) > k1Before)
  await js(`document.querySelector('${sel(K2)} .fw-tab[data-tab="${K1}"]').click()`)
  await sleep(400)
  check('clicar numa aba mostra aquele elemento', !(await isHidden(K1)) && (await isHidden(K2)) && (await tabsIn(K1)).find((x) => x.id === K1)?.active === true)
  await dragHeader(K3, K1)
  check('soltar outro elemento no grupo vira a terceira aba', (await tabsIn(K3)).length === 3)
  await sleep(1200)
  const saved = t.canvasFile('origin').nodes.filter((n) => [K1, K2, K3].includes(n.id))
  check('grupo de abas fica salvo no canvas', saved.length === 3 && new Set(saved.map((n) => n.data.stack)).size === 1 && saved.filter((n) => n.data.stackActive).length === 1)

  // The group drags by the free part of its header, and every member goes along.
  const head = await headerOf(K1)
  const lastTab = await t.rect(`${sel(K1)} .fw-tab:last-child`)
  const gx = (lastTab.x + lastTab.w + head.x + head.w - 60) / 2
  check('sobra área livre no cabeçalho do grupo para arrastar', gx > lastTab.x + lastTab.w + 5, JSON.stringify({ head, lastTab }))
  const posBefore = t.canvasFile('origin').nodes.find((n) => n.id === K1).position
  const atGrip = await js(`(() => { const e = document.elementFromPoint(${gx}, ${head.y + head.h / 2}); return e.className + ' | in ' + (e.closest('.react-flow__node')?.dataset.id || '-') + ' | drag:' + !!e.closest('.fw-drag') + ' nodrag:' + !!e.closest('.nodrag') })()`)
  await drag(gx, head.y + head.h / 2, gx + 120, head.y + head.h / 2 + 90)
  await sleep(1200)
  const members = t.canvasFile('origin').nodes.filter((n) => [K1, K2, K3].includes(n.id))
  const moved = members.every((n) => n.position.x === members[0].position.x && n.position.y === members[0].position.y) && members[0].position.x !== posBefore.x
  check('arrastar o grupo pelo cabeçalho move todos os membros', moved, JSON.stringify(members.map((n) => n.position)) + ' ponto: ' + atGrip)
  const tabStyle = await js(`(() => { const x = document.querySelector('${sel(K1)} .fw-tab:not(.active)'); const c = getComputedStyle(x); return c.backgroundColor })()`)
  check('aba inativa tem fundo próprio (não herda a cor do cabeçalho)', tabStyle !== 'rgba(0, 0, 0, 0)', tabStyle)

  // Dragging a tab out of the header takes it out of the group.
  const tab = await t.stableRect(`${sel(K3)} .fw-tab[data-tab="${K3}"]`)
  await drag(tab.x + tab.w / 2, tab.y + tab.h / 2, tab.x + tab.w / 2 + 40, tab.y + 260)
  await sleep(500)
  check('arrastar uma aba para fora separa o elemento', !(await isHidden(K3)) && (await js(`document.querySelectorAll('${sel(K3)} .fw-tab').length`)) === 0 && (await tabsIn(K1)).length === 2)
  await t.menu(K1, 'Tirar do grupo de abas')
  await sleep(400)
  check('tirar do grupo pelo menu desfaz um grupo de dois', !(await isHidden(K1)) && !(await isHidden(K2)) && (await js(`document.querySelectorAll('.fw-tab').length`)) === 0)

  // A tab group moves to another workspace as a whole, tabs kept.
  await dragHeader(K2, K1)
  await t.menu(K2, 'Mover o grupo de abas')
  await t.waitFor(`!!document.querySelector('.fw-move-list [data-ws="dest"]')`, 3000)
  await js(`document.querySelector('.fw-move-list [data-ws="dest"]')?.click()`)
  await sleep(1500)
  const inDest = await js(`[...document.querySelectorAll('.fw-hidden .react-flow__node')].map(n => n.dataset.id)`)
  const destGroup = t.canvasFile('dest').nodes.filter((n) => n.id === K1 || n.id === K2)
  check('mover um elemento agrupado leva o grupo inteiro, com as abas',
    inDest.includes(K1) && inDest.includes(K2) && destGroup.length === 2 && destGroup[0].data.stack && destGroup[0].data.stack === destGroup[1].data.stack &&
      !t.canvasFile('origin').nodes.some((n) => n.id === K1 || n.id === K2),
    JSON.stringify(destGroup.map((n) => n.data.stack)))
}
