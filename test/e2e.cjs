/**
 * End-to-end checks driven with trusted input events (sendInputEvent) inside the real app.
 * Loaded by the FW_TEST hook in src/main; run it with `npm run test:e2e`.
 */
const { clipboard } = require('electron')
const fs = require('fs')
const path = require('path')
// Scratch dir created by run-e2e.mjs: holds the data dir and the file used by the rename test.
const S = process.env.FW_E2E_DIR
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)

module.exports = async (win) => {
  const wc = win.webContents
  const js = (code) => wc.executeJavaScript(code)
  const shot = async (name) => fs.writeFileSync(path.join(S, name), (await wc.capturePage()).toPNG())
  const mouse = (type, x, y, button = 'left', clickCount = 1) =>
    wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button, clickCount })
  const click = async (x, y, button = 'left') => {
    mouse('mouseDown', x, y, button)
    mouse('mouseUp', x, y, button)
    await sleep(150)
  }
  const drag = async (x1, y1, x2, y2, button = 'left') => {
    mouse('mouseDown', x1, y1, button)
    for (let i = 1; i <= 8; i++) {
      mouse('mouseMove', x1 + ((x2 - x1) * i) / 8, y1 + ((y2 - y1) * i) / 8, button)
      await sleep(20)
    }
    mouse('mouseUp', x2, y2, button)
    await sleep(200)
  }
  const key = async (keyCode, modifiers = []) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    await sleep(100)
  }
  const type = async (text) => {
    for (const c of text) wc.sendInputEvent({ type: 'char', keyCode: c })
    await sleep(100)
  }
  const waitFor = async (code, ms = 15000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (await js(code)) return true
    return false
  }
  const rect = (sel) =>
    js(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
  const clickText = (sel, text) =>
    js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.includes(${JSON.stringify(text)})); b?.click(); return !!b })()`)

  win.focus()
  wc.setBackgroundThrottling(false) // an occluded test window would pause rAF (xterm rendering, zoom animation)
  await sleep(1500)
  // 1. stand-by on startup
  check('stand-by: nenhum workspace carregado ao abrir', await js(`!!document.querySelector('.fw-empty') && !document.querySelector('.xterm')`))
  await shot('t1-standby.png')

  // 2. open from list
  await clickText('.fw-ws', 'Teste')
  await waitFor(`[...document.querySelectorAll('.xterm-rows > div')].some(r => r.textContent.trim().startsWith('ABCDEFGHIJ'))`)
  await sleep(300)
  check('abre ao clicar na lista', await js(`!!document.querySelector('.xterm') && !!document.querySelector('.fw-ws-dot.on')`))
  check('indicador de zoom mostra 50%', (await js(`document.querySelector('.fw-zoom-value')?.textContent`)) === '50%')

  // 2a. growing a terminal must not duplicate lines (ConPTY repaints; xterm must not also pull
  // scrollback into the new rows)
  const t2 = '.react-flow__node[data-id="t2"]'
  await waitFor(`[...document.querySelectorAll('${t2} .xterm-rows > div')].some(r => r.textContent.trim() === 'MARK-40')`)
  await sleep(500)
  const t2head = await rect(`${t2} .fw-node-title`)
  await click(t2head.x + 10, t2head.y + t2head.h / 2)
  for (let i = 0; i < 3; i++) {
    const h = await rect(`${t2} .react-flow__resize-control.handle.bottom.right`)
    await drag(h.x + h.w / 2, h.y + h.h / 2, h.x + h.w / 2, h.y + h.h / 2 + 60)
    await sleep(600)
  }
  // Whole buffer (scrollback + screen), not just what is visible: each line exactly once.
  const marks = await js(`(() => {
    const b = window.__fwTerminals.get('t2').term.buffer.active
    const out = []
    for (let i = 0; i < b.length; i++) { const t = b.getLine(i).translateToString(true).trim(); if (/^MARK-\\d+$/.test(t)) out.push(t) }
    return out
  })()`)
  const dupes = [...new Set(marks.filter((m, i) => marks.indexOf(m) !== i))]
  const missing = Array.from({ length: 40 }, (_, i) => `MARK-${i + 1}`).filter((m) => !marks.includes(m))
  check('expandir o terminal não duplica nem perde linhas', !dupes.length && !missing.length,
    `repetidas: ${dupes.join(',') || 'nenhuma'}; perdidas: ${missing.join(',') || 'nenhuma'}`)

  // 2a'. composer under the selected terminal: Shift+Enter breaks the line, Enter sends
  const comp = `${t2} .fw-composer textarea`
  check('caixa de texto aparece abaixo do terminal selecionado', await waitFor(`!!document.querySelector('${comp}')`, 2000))
  const cbox = await rect(comp)
  await click(cbox.x + 20, cbox.y + cbox.h / 2)
  await type('echo COMP_A')
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return', modifiers: ['shift'] })
  wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers: ['shift'] })
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return', modifiers: ['shift'] })
  await sleep(150)
  await type('echo COMP_B')
  const draft = await js(`document.querySelector('${comp}').value`)
  check('Shift+Enter quebra a linha na caixa', draft === 'echo COMP_A\necho COMP_B', JSON.stringify(draft))
  await key('Return')
  const ran = await waitFor(`(() => { const t = [...document.querySelectorAll('${t2} .xterm-rows > div')].map(r => r.textContent.trim()); return t.includes('COMP_A') && t.includes('COMP_B') })()`, 8000)
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

  // 2b. Claude session node: resumes the stored conversation, follows hook events
  const AI = '11111111-1111-4111-8111-111111111111'
  const OLD = '22222222-2222-4222-8222-222222222222'
  const NEW = '33333333-3333-4333-8333-333333333333'
  const aiSel = `.react-flow__node[data-id="${AI}"]`
  const aiText = () => js(`[...document.querySelectorAll('${aiSel} .xterm-rows > div')].map(r => r.textContent).join('').replace(/\\s/g, '')`)
  await waitFor(`[...document.querySelectorAll('${aiSel} .xterm-rows > div')].some(r => r.textContent.trim().startsWith('CLAUDE_CMD'))`)
  const launched = await aiText()
  check('sessão Claude reabre com --resume da última sessão', launched.includes('--resume' + OLD) && launched.includes('--settings'), launched.slice(-160))
  check('cabeçalho mostra a branch do diretório', await waitFor(`document.querySelector('${aiSel} .fw-node-title')?.textContent.includes('⎇ main')`, 5000))

  const hookUrl = JSON.parse(fs.readFileSync(path.join(S, 'fwdata', 'hooks', AI + '.json'), 'utf8')).hooks.Stop[0].hooks[0].url
  const hook = (url, event, session) =>
    fetch(url, { method: 'POST', body: JSON.stringify({ hook_event_name: event, session_id: session }) })
  await hook(hookUrl.replace(/hook\/[^/]+/, 'hook/segredo-errado'), 'UserPromptSubmit', NEW)
  await sleep(400)
  check('hook com segredo errado é ignorado', !(await js(`!!document.querySelector('${aiSel} .fw-status')`)))
  await hook(hookUrl, 'UserPromptSubmit', NEW)
  check('hook de prompt marca a sessão como trabalhando', await waitFor(`!!document.querySelector('${aiSel} .fw-status.working')`, 3000))
  await hook(hookUrl, 'Stop', NEW)
  check('hook de fim de turno marca como ociosa', await waitFor(`!!document.querySelector('${aiSel} .fw-status.idle')`, 3000))
  await sleep(1200) // autosave debounce
  const savedNode = JSON.parse(fs.readFileSync(path.join(S, 'fwdata', 'workspaces', 'test', 'canvas.json'), 'utf8')).nodes.find((n) => n.id === AI)
  check('nó guarda a sessão nova informada pelo hook', savedNode.data.sessionId === NEW, savedNode.data.sessionId)

  // 2b'. MCP: sessions talking to each other (the test plays the MCP client and B's hooks)
  const B = '44444444-4444-4444-8444-444444444444'
  const C = '55555555-5555-4555-8555-555555555555'
  const hooksDir = path.join(S, 'fwdata', 'hooks')
  const cfg = (id) => JSON.parse(fs.readFileSync(path.join(hooksDir, id + '.mcp.json'), 'utf8')).mcpServers['free-workspace'].url
  const hookOf = (id) => JSON.parse(fs.readFileSync(path.join(hooksDir, id + '.json'), 'utf8')).hooks.Stop[0].hooks[0].url
  await waitFor(`[...document.querySelectorAll('.react-flow__node[data-id="${B}"] .xterm-rows > div')].some(r => r.textContent.trim().startsWith('B_CMD'))`)
  let rpcId = 0
  // Answers come as JSON, or as an SSE stream for the blocking ask_session.
  const mcp = async (id, method, params = {}) => {
    const r = await fetch(cfg(id), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })
    })
    const body = await r.text()
    return JSON.parse(body.startsWith('{') ? body : body.split('\n').find((l) => l.startsWith('data: ')).slice(6))
  }
  const call = async (id, name, args = {}) => (await mcp(id, 'tools/call', { name, arguments: args })).result
  const bRows = () => js(`[...document.querySelectorAll('.react-flow__node[data-id="${B}"] .xterm-rows > div')].map(r => r.textContent).join('\\n')`)

  const init = (await mcp(AI, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } })).result
  check('MCP initialize devolve instruções com nome e papel da sessão',
    init.protocolVersion === '2025-06-18' && init.instructions.includes('Free Workspace') && init.instructions.includes('"Claude"') && init.instructions.includes('papel do front'))
  const tools = (await mcp(AI, 'tools/list')).result.tools.map((t) => t.name).join(',')
  check('MCP lista as ferramentas', tools === 'list_sessions,ask_session,send_message,open_file,create_note,create_todo,open_terminal', tools)
  const listed = (await call(AI, 'list_sessions')).content[0].text
  check('list_sessions mostra só a sessão conectada, com o papel', listed.includes('"Backend"') && listed.includes('cuida da API') && !listed.includes('Revisor'), listed)
  check('sessão sem conexões não enxerga ninguém', (await call(C, 'list_sessions')).content[0].text.includes('Nenhuma sessão conectada'))
  const denied = await call(AI, 'ask_session', { session: 'Revisor', message: 'oi' })
  check('perguntar para sessão não conectada é recusado', denied.isError === true && denied.content[0].text.includes('não está conectado'))

  const answer = call(AI, 'ask_session', { session: 'Backend', message: 'PERGUNTA_E2E qual a rota?' })
  const delivered = await waitFor(`[...document.querySelectorAll('.react-flow__node[data-id="${B}"] .xterm-rows > div')].some(r => r.textContent.includes('PERGUNTA_E2E'))`, 8000)
  const token = ((await bRows()).match(/fw-msg [0-9a-f]{8}/) || [])[0]
  check('ask_session digita a mensagem no terminal do destino', delivered && !!token, token)
  check('conexão fica animada enquanto espera a resposta', await waitFor(`!!document.querySelector('.react-flow__edge.animated')`, 3000))
  const SB = '66666666-6666-4666-8666-666666666666'
  const post = (url, payload) => fetch(url, { method: 'POST', body: JSON.stringify(payload) })
  // A Stop from a turn that was already running must not be taken as the answer.
  await post(hookOf(B), { hook_event_name: 'Stop', session_id: SB, last_assistant_message: 'TURNO_ANTIGO' })
  await post(hookOf(B), { hook_event_name: 'UserPromptSubmit', session_id: SB, prompt: `[${token}] Mensagem da sessão...` })
  await post(hookOf(B), { hook_event_name: 'Stop', session_id: SB, last_assistant_message: 'RESPOSTA_B: /api/v1' })
  const got = (await answer).content[0].text
  check('ask_session devolve o texto final do turno do destino', got === 'RESPOSTA_B: /api/v1', got)
  check('conexão para de animar depois da resposta', await waitFor(`!document.querySelector('.react-flow__edge.animated')`, 3000))

  // 2b''. canvas tools: a session puts things on the canvas next to itself
  const allow = JSON.parse(fs.readFileSync(path.join(hooksDir, AI + '.json'), 'utf8')).permissions.allow
  check('open_terminal não vem pré-autorizado (Claude pede confirmação)', allow.includes('mcp__free-workspace__create_note') && !allow.some((t) => t.includes('open_terminal')), allow.join(','))
  const nodeCount = (type) => js(`document.querySelectorAll('.react-flow__node-${type}').length`)
  const notesBefore = await nodeCount('note')
  await call(AI, 'create_note', { text: '# Plano E2E\n\n- passo 1' })
  check('create_note cria a nota no canvas', await waitFor(`[...document.querySelectorAll('.react-flow__node-note')].some(n => n.textContent.includes('Plano E2E'))`, 3000) && (await nodeCount('note')) === notesBefore + 1)
  await call(AI, 'create_todo', { title: 'Tarefas E2E', items: ['revisar', 'testar'] })
  check('create_todo cria a lista com os itens', await waitFor(`[...document.querySelectorAll('.react-flow__node-todo')].some(n => n.textContent.includes('Tarefas E2E') && n.textContent.includes('revisar') && n.textContent.includes('testar'))`, 3000))
  const missing404 = await call(AI, 'open_file', { path: 'nao-existe.txt' })
  check('open_file de arquivo inexistente devolve erro', missing404.isError === true && missing404.content[0].text.includes('não encontrado'))
  await call(AI, 'open_file', { path: 'README.md' })
  check('open_file abre arquivo relativo ao diretório da sessão', await waitFor(`[...document.querySelectorAll('.react-flow__node-file .fw-node-title')].some(t => t.textContent.startsWith('README.md'))`, 3000))
  await call(AI, 'open_terminal', { title: 'Dev E2E', command: 'echo TOOL_TERM' })
  check('open_terminal abre um terminal rodando o comando', await waitFor(`[...document.querySelectorAll('.react-flow__node-terminal')].some(n => n.textContent.includes('Dev E2E') && [...n.querySelectorAll('.xterm-rows > div')].some(r => r.textContent.trim() === 'TOOL_TERM'))`, 10000))

  // connect A -> C by dragging between their dots
  const dot = (id, side) => rect(`.react-flow__node[data-id="${id}"] .fw-handle[data-handleid="${side}"]`)
  const from = await dot(AI, 'r')
  const to = await dot(C, 'l')
  await drag(from.x + from.w / 2, from.y + from.h / 2, to.x + to.w / 2, to.y + to.h / 2)
  const linked = await waitFor(`document.querySelectorAll('.react-flow__edge').length === 2`, 3000)
  await sleep(300)
  check('arrastar entre os pontos conecta duas sessões', linked && (await call(AI, 'list_sessions')).content[0].text.includes('"Revisor"'))

  // Optional: the real Claude Code CLI as MCP client (FW_E2E_REAL=1; spends a few tokens).
  if (process.env.FW_E2E_REAL) {
    const { spawn } = require('child_process')
    const q = (p) => `"${p.replace(/\\/g, '/')}"`
    const prompt = 'Use a ferramenta ask_session para perguntar a sessao Backend: "PERGUNTA_REAL qual a porta?". Responda apenas com o texto que ela devolver.'
    const child = spawn(`claude -p ${JSON.stringify(prompt)} --model haiku --settings ${q(path.join(hooksDir, AI + '.json'))} --mcp-config ${q(path.join(hooksDir, AI + '.mcp.json'))}`,
      { cwd: S, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    const done = new Promise((r) => child.on('close', r))
    const arrived = await waitFor(`[...document.querySelectorAll('.react-flow__node[data-id="${B}"] .xterm-rows > div')].some(r => r.textContent.includes('PERGUNTA_REAL'))`, 90000)
    const tokens = (await bRows()).match(/fw-msg [0-9a-f]{8}/g) || []
    await post(hookOf(B), { hook_event_name: 'UserPromptSubmit', session_id: SB, prompt: `[${tokens[tokens.length - 1]}]` })
    await post(hookOf(B), { hook_event_name: 'Stop', session_id: SB, last_assistant_message: 'RESPOSTA_REAL porta 3000' })
    await Promise.race([done, sleep(90000)])
    check('Claude Code real pergunta via MCP e recebe a resposta', arrived && out.includes('3000'), out.trim().slice(-200))
  }

  // 2c. terminal in a new git worktree
  await clickText('.fw-toolbar button', 'Terminal')
  await sleep(300)
  await js(`[...document.querySelectorAll('.fw-modal .fw-check')].find(l => l.textContent.includes('worktree')).querySelector('input').click()`)
  await sleep(200)
  await js(`document.querySelector('.fw-modal input[placeholder^="ex.: feat"]').focus()`)
  await type('feat/e2e')
  await clickText('.fw-modal button', 'Criar')
  const wtNode = await waitFor(`[...document.querySelectorAll('.fw-node-title')].some(t => t.textContent.includes('⎇ feat/e2e (worktree)'))`, 10000)
  check('terminal em worktree nova: pasta criada e branch no cabeçalho', wtNode && fs.existsSync(path.join(S, 'repo.worktrees', 'feat-e2e', 'README.md')),
    await js(`document.querySelector('.fw-modal-error')?.textContent || ''`))

  // 3. selection at zoom 50% + Ctrl+C
  const pos = await js(`(() => {
    const row = [...document.querySelectorAll('.xterm-rows > div')].find(r => r.textContent.trim().startsWith('ABCDEFGHIJ'))
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
    await key('C', ['control'])
    await sleep(400)
    const got = await clipboard.readText()
    check('seleção com zoom 50% + Ctrl+C copia o texto certo', got === 'ABCDEFGHIJ', `clipboard="${got}"`)
  }

  // 4. Ctrl+V text into terminal
  await clipboard.writeText('echo PASTED_OK')
  const term = await rect('.fw-terminal')
  await click(term.x + term.w / 2, term.y + term.h - 20)
  await key('V', ['control'])
  await sleep(300)
  await key('Return')
  await waitFor(`[...document.querySelectorAll('.xterm-rows > div')].some(r => r.textContent.trim() === 'PASTED_OK')`, 8000)
  const pasted = await js(`[...document.querySelectorAll('.xterm-rows > div')].filter(r => r.textContent.trim() === 'PASTED_OK').length`)
  check('Ctrl+V cola texto no terminal', pasted >= 1, `linhas de saída=${pasted}`)

  // 5. zoom indicator click -> 100%
  await clickText('.fw-zoom-value', '%')
  const z100 = await waitFor(`document.querySelector('.fw-zoom-value').textContent === '100%'`, 3000)
  check('clicar no indicador volta para 100%', z100, await js(`document.querySelector('.fw-zoom-value').textContent`))

  // 6. context menu on node -> rename (fit view first so the nodes are on screen)
  await js(`document.querySelector('.react-flow__controls-fitview').click()`)
  await sleep(500)
  const head = await rect('.react-flow__node-terminal .fw-node-title')
  console.log('[test] terminal header rect', JSON.stringify(head))
  await click(head.x + 20, head.y + head.h / 2, 'right')
  await sleep(200)
  check('menu de contexto do nó abre', await js(`[...document.querySelectorAll('.fw-menu button')].some(b => b.textContent === 'Reiniciar processo')`))
  await clickText('.fw-menu button', 'Renomear')
  await sleep(200)
  await key('A', ['control'])
  await type('Meu Terminal')
  await key('Return')
  await sleep(300)
  check('renomear nó pelo menu', (await js(`document.querySelector('.react-flow__node-terminal .fw-node-title').firstChild.textContent`)) === 'Meu Terminal')

  // 7. rename file node by double click -> renames on disk
  const fhead = await rect('.react-flow__node-file .fw-node-title')
  if (!fhead) check('nó de arquivo visível', false)
  else {
    const fx = fhead.x + 15
    const fy = fhead.y + fhead.h / 2
    mouse('mouseDown', fx, fy, 'left', 1)
    mouse('mouseUp', fx, fy, 'left', 1)
    mouse('mouseDown', fx, fy, 'left', 2)
    mouse('mouseUp', fx, fy, 'left', 2)
    const editing = await waitFor(`document.activeElement?.matches('.react-flow__node-file .fw-title-input')`, 3000)
    if (!editing) check('duplo clique no título abre a edição', false)
    await key('A', ['control'])
    await type('renomeado.txt')
    await key('Return')
    await sleep(600)
    check('renomear arquivo renomeia no disco', fs.existsSync(path.join(S, 'renomeado.txt')) && !fs.existsSync(path.join(S, 'renametest.txt')))
  }

  // 8. right-drag pans without menu; right-click opens pane menu
  const vp = () => js(`document.querySelector('.react-flow__viewport').style.transform`)
  const before = await vp()
  // An empty spot of the pane (no node under it, nor under where the drag ends).
  const spot = await js(`(() => {
    const free = (x, y) => document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')
    const r = document.querySelector('.fw-canvas').getBoundingClientRect()
    for (let y = r.bottom - 60; y > r.top + 160; y -= 40)
      for (let x = r.right - 60; x > r.left + 160; x -= 40)
        if (free(x, y) && free(x - 100, y - 60)) return { x, y }
  })()`)
  if (!spot) check('ponto vazio no canvas para arrastar', false)
  await drag(spot.x, spot.y, spot.x - 100, spot.y - 60, 'right')
  const after = await vp()
  check('arrastar com botão direito move o canvas', before !== after, `${before} -> ${after}`)
  check('arrastar com botão direito não abre menu', !(await js(`!!document.querySelector('.fw-menu')`)))
  await click(spot.x, spot.y, 'right')
  await sleep(200)
  check('clique direito simples no canvas abre menu de criação', await js(`[...document.querySelectorAll('.fw-menu button')].some(b => b.textContent.includes('Sessão IA'))`))
  await shot('t2-menu.png')
  await key('Escape')
  await sleep(150)

  // 9. settings: hide minimap
  check('minimapa visível por padrão', await js(`!!document.querySelector('.react-flow__minimap')`))
  await clickText('.fw-ws', 'Configurações')
  await sleep(200)
  await js(`[...document.querySelectorAll('.fw-check')].find(l => l.textContent.includes('minimapa')).querySelector('input').click()`)
  await clickText('.fw-modal button', 'Salvar')
  await sleep(400)
  const saved = JSON.parse(fs.readFileSync(path.join(S, 'fwdata', 'settings.json'), 'utf8'))
  check('desligar minimapa nas configurações', !(await js(`!!document.querySelector('.react-flow__minimap')`)) && saved.showMinimap === false)
  await shot('t3-final.png')

  // 9b. switching workspace hides the previous one's nodes; each canvas draws its own grid
  await clickText('.fw-ws', 'Outro')
  await waitFor(`!!document.querySelector('.react-flow__node[data-id="n-other"]')`, 5000)
  await sleep(500)
  const leaks = await js(`(() => {
    const hidden = [...document.querySelectorAll('.fw-hidden .react-flow__node')]
    return { total: hidden.length, visible: hidden.filter(n => getComputedStyle(n).visibility !== 'hidden').length }
  })()`)
  check('nós do workspace anterior ficam invisíveis ao trocar', leaks.total > 0 && leaks.visible === 0, JSON.stringify(leaks))
  const grids = await js(`(() => {
    const ids = [...document.querySelectorAll('.react-flow__background pattern')].map(p => p.id)
    return { canvases: document.querySelectorAll('.react-flow').length, distinct: new Set(ids).size }
  })()`)
  check('cada canvas tem o próprio fundo pontilhado', grids.canvases === 2 && grids.distinct === 2, JSON.stringify(grids))
  await clickText('.fw-ws', 'Teste')
  await sleep(400)

  // 9c. explorer node
  const x1 = '.react-flow__node[data-id="x1"]'
  const treeRows = () => js(`[...document.querySelectorAll('${x1} .fw-tree-row')].map(r => r.textContent.replace(/^[▸▾]/, '').trim())`)
  await waitFor(`[...document.querySelectorAll('${x1} .fw-tree-row')].some(r => r.textContent.includes('README.md'))`, 5000)
  const rows0 = await treeRows()
  check('explorador lista a pasta (pastas primeiro, sem .git)', rows0[0] === 'src' && rows0.includes('README.md') && !rows0.includes('.git'), rows0.join(','))
  const clickRow = (name) => js(`[...document.querySelectorAll('${x1} .fw-tree-row')].find(r => r.textContent.replace(/^[▸▾]/, '').trim() === ${JSON.stringify(name)}).click()`)
  const readmeNodes = `[...document.querySelectorAll('.react-flow__node-file .fw-node-title')].filter(t => t.textContent.startsWith('README.md')).length`
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
  const filtered = await treeRows()
  check('filtro mostra o caminho relativo dos arquivos encontrados', filtered.length === 1 && /^src[\\/]a\.ts$/.test(filtered[0]), filtered.join(','))
  await sleep(800)
  const xSaved = JSON.parse(fs.readFileSync(path.join(S, 'fwdata', 'workspaces', 'test', 'canvas.json'), 'utf8')).nodes.find((n) => n.id === 'x1')
  check('pastas abertas ficam salvas no nó', (xSaved.data.open ?? []).some((p) => p.endsWith('src')), JSON.stringify(xSaved.data.open))

  await shot('t-explorer.png')

  // 9d. trash
  const wsDir = (id) => path.join(S, 'fwdata', 'workspaces', id)
  check('lixeira vencida é apagada ao abrir o app (e a recente fica)', !fs.existsSync(wsDir('velho')) && fs.existsSync(wsDir('recente')))
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
  check('excluir agora apaga a pasta do workspace', await waitFor(`!${wsButton('Outro')}`, 3000) && (await sleep(300), !fs.existsSync(wsDir('other'))))

  // 10. stand-by from context menu
  const ws = await rect('.fw-ws.active')
  await click(ws.x + 30, ws.y + ws.h / 2, 'right')
  await sleep(200)
  await clickText('.fw-menu button', 'stand-by')
  await sleep(400)
  // "Outro" is still open in the background; only "Teste" must be unloaded.
  check('colocar em stand-by descarrega o workspace',
    await js(`!!document.querySelector('.fw-empty') && !document.querySelector('.react-flow__node-terminal') && !![...document.querySelectorAll('.fw-ws')].find(b => b.textContent.includes('Teste'))?.querySelector('.fw-ws-dot:not(.on)')`))

  console.log('\n' + results.join('\n'))
  if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1
}
