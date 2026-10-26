// Claude sessions: exact resume, hook events, readiness, the MCP server (messaging and canvas
// tools, open_session), connecting by dragging, converting a terminal into a session.
// The "CLI" of each session is an echo (FW_CLAUDE_BIN too): the test sees the arguments the
// app appends and plays the hooks itself.
const fs = require('fs')
const path = require('path')
const harness = require('./harness.cjs')

const AI = '11111111-1111-4111-8111-111111111111'
const B = '44444444-4444-4444-8444-444444444444'
const C = '55555555-5555-4555-8555-555555555555'
const MANUAL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OLD = '22222222-2222-4222-8222-222222222222'
const NEW = '33333333-3333-4333-8333-333333333333'

module.exports = async (win) => {
  const t = harness(win)
  const { S, js, check, sleep, waitFor, rect, drag, call } = t
  const hooksDir = path.join(S, 'fwdata', 'hooks')
  const nodeSel = (id) => `.react-flow__node[data-id="${id}"]`
  await t.start()
  await t.openWorkspace('Teste')

  // Exact resume and hook-driven status.
  await t.waitBuffer(AI, 'CLAUDE_CMD')
  const launched = (await t.bufferText(AI)).replace(/\s/g, '')
  check('sessão Claude reabre com --resume da última sessão', launched.includes('--resume' + OLD) && launched.includes('--settings'), launched.slice(-160))
  check('cabeçalho mostra a branch do diretório', await waitFor(`document.querySelector('${nodeSel(AI)} .fw-node-title')?.textContent.includes('⎇ main')`, 5000))
  await fetch(t.hookUrl(AI).replace(/hook\/[^/]+/, 'hook/segredo-errado'), { method: 'POST', body: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: NEW }) })
  await sleep(400)
  check('hook com segredo errado é ignorado', !(await js(`!!document.querySelector('${nodeSel(AI)} .fw-status')`)))
  await t.hook(AI, { hook_event_name: 'UserPromptSubmit', session_id: NEW })
  check('hook de prompt marca a sessão como trabalhando', await waitFor(`!!document.querySelector('${nodeSel(AI)} .fw-status.working')`, 3000))
  await t.hook(AI, { hook_event_name: 'Stop', session_id: NEW })
  check('hook de fim de turno marca como ociosa', await waitFor(`!!document.querySelector('${nodeSel(AI)} .fw-status.idle')`, 3000))
  await sleep(1200) // autosave debounce
  check('nó guarda a sessão nova informada pelo hook', t.canvasFile('test').nodes.find((n) => n.id === AI).data.sessionId === NEW)

  // Readiness: a message to a session still starting waits for its SessionStart.
  await t.waitBuffer(B, 'B_CMD')
  const startHook = t.hooksFile(B).hooks.SessionStart[0].hooks[0]
  check('SessionStart vira hook de comando com curl', startHook.type === 'command' && /curl(\.exe)? -s -X POST --data-binary @- http:\/\/127\.0\.0\.1:\d+\/hook\//.test(startHook.command), startHook.command)
  const sessionStart = (id, sid) => t.hook(id, { hook_event_name: 'SessionStart', session_id: sid, source: 'startup' })
  const early = call(AI, 'send_message', { session: 'Backend', message: 'AVISO_CEDO' })
  await sleep(1500)
  const tooSoon = (await t.bufferText(B)).includes('AVISO_CEDO')
  await sessionStart(B, '77777777-7777-4777-8777-777777777777')
  const earlyResult = await early
  check('mensagem para sessão iniciando espera ela ficar pronta', !tooSoon && (await t.waitBuffer(B, 'AVISO_CEDO', 4000)) && !earlyResult.isError, earlyResult.content[0].text)
  await sessionStart(AI, '88888888-8888-4888-8888-888888888888')
  await sessionStart(C, '99999999-9999-4999-8999-999999999999')

  // MCP basics and messaging.
  const init = (await t.mcp(AI, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } })).result
  check('MCP initialize devolve instruções com nome e papel da sessão',
    init.protocolVersion === '2025-06-18' && init.instructions.includes('Free Workspace') && init.instructions.includes('"Claude"') && init.instructions.includes('papel do front'))
  const tools = (await t.mcp(AI, 'tools/list')).result.tools.map((x) => x.name).join(',')
  check('MCP lista as ferramentas', tools === 'list_sessions,ask_session,send_message,open_file,create_note,create_todo,open_terminal,open_session', tools)
  const listed = (await call(AI, 'list_sessions')).content[0].text
  check('list_sessions mostra só a sessão conectada, com o papel', listed.includes('"Backend"') && listed.includes('cuida da API') && !listed.includes('Revisor'), listed)
  check('sessão sem conexões não enxerga ninguém', (await call(C, 'list_sessions')).content[0].text.includes('Nenhuma sessão conectada'))
  const denied = await call(AI, 'ask_session', { session: 'Revisor', message: 'oi' })
  check('perguntar para sessão não conectada é recusado', denied.isError === true && denied.content[0].text.includes('não está conectado'))

  const answer = call(AI, 'ask_session', { session: 'Backend', message: 'PERGUNTA_E2E qual a rota?' })
  let token
  for (let i = 0; i < 40 && !token; i++) {
    const buf = await t.bufferText(B)
    if (buf.includes('PERGUNTA_E2E')) token = (buf.match(/fw-msg [0-9a-f]{8}/) || [])[0]
    else await sleep(200)
  }
  check('ask_session digita a mensagem no terminal do destino', !!token, token)
  check('conexão fica animada enquanto espera a resposta', await waitFor(`!!document.querySelector('.react-flow__edge.animated')`, 3000))
  const SB = '66666666-6666-4666-8666-666666666666'
  // A Stop from a turn that was already running must not be taken as the answer.
  await t.hook(B, { hook_event_name: 'Stop', session_id: SB, last_assistant_message: 'TURNO_ANTIGO' })
  await t.hook(B, { hook_event_name: 'UserPromptSubmit', session_id: SB, prompt: `[${token}] Mensagem da sessão...` })
  await t.hook(B, { hook_event_name: 'Stop', session_id: SB, last_assistant_message: 'RESPOSTA_B: /api/v1' })
  const got = (await answer).content[0].text
  check('ask_session devolve o texto final do turno do destino', got === 'RESPOSTA_B: /api/v1', got)
  check('conexão para de animar depois da resposta', await waitFor(`!document.querySelector('.react-flow__edge.animated')`, 3000))

  // Canvas tools.
  const allow = t.hooksFile(AI).permissions.allow
  check('open_terminal e open_session não vêm pré-autorizados', allow.includes('mcp__free-workspace__create_note') && !allow.some((x) => x.includes('open_terminal') || x.includes('open_session')), allow.join(','))
  const nodeCount = (type) => js(`document.querySelectorAll('.react-flow__node-${type}').length`)
  const notesBefore = await nodeCount('note')
  await call(AI, 'create_note', { text: '# Plano E2E\n\n- passo 1' })
  check('create_note cria a nota no canvas', (await waitFor(`[...document.querySelectorAll('.react-flow__node-note')].some(n => n.textContent.includes('Plano E2E'))`, 3000)) && (await nodeCount('note')) === notesBefore + 1)
  await call(AI, 'create_todo', { title: 'Tarefas E2E', items: ['revisar', 'testar'] })
  check('create_todo cria a lista com os itens', await waitFor(`[...document.querySelectorAll('.react-flow__node-todo')].some(n => n.textContent.includes('Tarefas E2E') && n.textContent.includes('revisar') && n.textContent.includes('testar'))`, 3000))
  const missing404 = await call(AI, 'open_file', { path: 'nao-existe.txt' })
  check('open_file de arquivo inexistente devolve erro', missing404.isError === true && missing404.content[0].text.includes('não encontrado'))
  await call(AI, 'open_file', { path: 'README.md' })
  check('open_file abre arquivo relativo ao diretório da sessão', await waitFor(`[...document.querySelectorAll('.react-flow__node-file .fw-node-title')].some(x => x.textContent.startsWith('README.md'))`, 3000))
  const claudeViaTerminal = await call(AI, 'open_terminal', { title: 'Outro Claude', command: 'claude --effort medium "faça X"' })
  check('open_terminal recusa iniciar o claude e aponta open_session', claudeViaTerminal.isError === true && claudeViaTerminal.content[0].text.includes('open_session'))
  await call(AI, 'open_terminal', { title: 'Dev E2E', command: 'echo TOOL_TERM' })
  check('open_terminal abre um terminal rodando o comando',
    await waitFor(`[...document.querySelectorAll('.react-flow__node-terminal')].some(n => n.textContent.includes('Dev E2E') && [...n.querySelectorAll('.xterm-rows > div')].some(r => r.textContent.trim() === 'TOOL_TERM'))`, 10000))

  // Connect A → C by dragging between their dots.
  await js(`document.querySelector('.react-flow__controls-fitview')?.click()`)
  await sleep(600)
  const dot = (id, side) => t.stableRect(`${nodeSel(id)} .fw-handle[data-handleid="${side}"]`)
  const from = await dot(AI, 'r')
  const to = await dot(C, 'l')
  await drag(from.x + from.w / 2, from.y + from.h / 2, to.x + to.w / 2, to.y + to.h / 2)
  await sleep(300)
  check('arrastar entre os pontos conecta duas sessões', (await waitFor(`document.querySelectorAll('.react-flow__edge').length === 2`, 3000)) && (await call(AI, 'list_sessions')).content[0].text.includes('"Revisor"'))

  // open_session: restricted, born connected, optional first task.
  const badEffort = await call(AI, 'open_session', { title: 'X', role: 'y', effort: 'max' })
  check('open_session recusa effort fora de medium/high', badEffort.isError === true && badEffort.content[0].text.includes('effort'))
  const outside = await call(AI, 'open_session', { title: 'X', role: 'y', cwd: S })
  check('open_session recusa diretório fora do projeto', outside.isError === true && outside.content[0].text.includes('Fora do permitido'), outside.content[0].text)
  const edgesBefore = await js(`document.querySelectorAll('.react-flow__edge').length`)
  const opened = await call(AI, 'open_session', { title: 'Helper', role: 'escreve testes', cwd: 'src', effort: 'high' })
  const byTitle = (title) => `[...document.querySelectorAll('.react-flow__node-terminal')].find(n => n.querySelector('.fw-node-title')?.textContent.startsWith(${JSON.stringify(title)}))`
  await waitFor(`!!${byTitle('Helper')}`, 5000)
  const helperId = await js(`${byTitle('Helper')}?.dataset.id`)
  check('open_session abre sessão com effort e papel, no diretório pedido',
    !opened.isError && (await t.waitBuffer(helperId, 'claude --effort high')) && (await js(`${byTitle('Helper')}.textContent.includes('escreve testes') && ${byTitle('Helper')}.textContent.includes('src')`)),
    opened.content[0].text)
  check('sessão aberta já nasce conectada a quem pediu',
    (await waitFor(`document.querySelectorAll('.react-flow__edge').length === ${edgesBefore + 1}`, 3000)) && (await call(AI, 'list_sessions')).content[0].text.includes('"Helper"'))
  const inWorktree = await call(AI, 'open_session', { title: 'WT', role: 'r', cwd: path.join(S, 'repo.worktrees', 'feat-e2e') })
  check('open_session aceita worktree do mesmo repositório', !inWorktree.isError, inWorktree.content[0].text)
  await call(AI, 'open_session', { title: 'Terceira', role: 'r', task: 'TAREFA_INICIAL faça Y' })
  await waitFor(`!!${byTitle('Terceira')}`, 5000)
  const thirdId = await js(`${byTitle('Terceira')}.dataset.id`)
  for (let i = 0; i < 25 && !fs.existsSync(path.join(hooksDir, thirdId + '.json')); i++) await sleep(200)
  await sleep(800)
  const taskTooSoon = (await t.bufferText(thirdId)).includes('TAREFA_INICIAL')
  await sessionStart(thirdId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  check('open_session entrega a tarefa inicial quando a sessão fica pronta', !taskTooSoon && (await t.waitBuffer(thirdId, 'TAREFA_INICIAL', 5000)))
  const fourth = await call(AI, 'open_session', { title: 'Quarta', role: 'r' })
  check('open_session respeita o limite de 3 por sessão', fourth.isError === true && fourth.content[0].text.includes('Limite'))

  // A terminal running claude by hand becomes a connectable session.
  check('terminal comum não tem pontos de conexão', !(await js(`!!document.querySelector('${nodeSel(MANUAL)} .fw-handle')`)))
  await t.menu(MANUAL, 'Converter em sessão Claude')
  let converted = ''
  for (let i = 0; i < 40 && !converted.includes('--mcp-config'); i++) {
    converted = (await t.bufferText(MANUAL)).replace(/\s+/g, ' ')
    await sleep(200)
  }
  check('converter terminal em sessão: ganha pontos de conexão e reinicia com --continue e MCP',
    (await js(`document.querySelectorAll('${nodeSel(MANUAL)} .fw-handle').length`)) === 2 && /claude --effort medium --continue --settings .* --mcp-config/.test(converted), converted.slice(-200))

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
    const arrived = await t.waitBuffer(B, 'PERGUNTA_REAL', 90000)
    const tokens = (await t.bufferText(B)).match(/fw-msg [0-9a-f]{8}/g) || []
    await t.hook(B, { hook_event_name: 'UserPromptSubmit', session_id: SB, prompt: `[${tokens[tokens.length - 1]}]` })
    await t.hook(B, { hook_event_name: 'Stop', session_id: SB, last_assistant_message: 'RESPOSTA_REAL porta 3000' })
    await Promise.race([done, sleep(90000)])
    check('Claude Code real pergunta via MCP e recebe a resposta', arrived && out.includes('3000'), out.trim().slice(-200))
  }
}
