// Reopening without running, per-terminal shell, "new version on disk", .http requests, what a
// session saves for the user, and sessions connected to notes and to-do lists.
const { clipboard } = require('electron')
const fs = require('fs')
const http = require('http')
const path = require('path')
const harness = require('./harness.cjs')

const SESSION = '11111111-1111-4111-8111-111111111111'

module.exports = async (win) => {
  const t = harness(win)
  const { S, js, check, skip, sleep, waitFor, call, drag } = t
  const nodeSel = (id) => `.react-flow__node[data-id="${id}"]`
  const nodeText = (id) => js(`document.querySelector('${nodeSel(id)}')?.textContent ?? ''`)
  const outputLine = async (id, text) => (await t.bufferText(id)).split('\n').some((l) => l.trim() === text)

  // What the .http file talks to. Before the workspace opens, so the file already has the port.
  const received = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, auth: req.headers.authorization, body })
      res.writeHead(req.method === 'POST' ? 201 : 200, { 'content-type': 'application/json', 'x-teste': 'sim' }).end(JSON.stringify({ ok: true, metodo: req.method }))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const apiFile = path.join(S, 'api.http')
  fs.writeFileSync(apiFile, fs.readFileSync(apiFile, 'utf8').replace('PORT', String(server.address().port)))

  await t.start()
  await t.openWorkspace('Teste')

  // Reopening with "run on reopen" off.
  await t.waitBuffer('fresh', 'FRESH_CMD')
  check('terminal novo roda o comando mesmo com a opção desligada', await waitFor2(() => outputLine('fresh', 'FRESH_CMD')))
  await t.waitBuffer('held', 'echo HELD_CMD')
  await sleep(2500)
  const heldBuffer = await t.bufferText('held')
  check('ao reabrir, o comando fica digitado sem rodar', heldBuffer.includes('echo HELD_CMD') && !(await outputLine('held', 'HELD_CMD')), heldBuffer.slice(-120))
  await js(`window.api.pty.write('held', '\\r')`)
  check('Enter do usuário envia o comando digitado', await waitFor2(() => outputLine('held', 'HELD_CMD')))
  await t.menu('held', 'Reiniciar processo')
  await sleep(500)
  check('"Reiniciar" roda o comando direto', await waitFor2(() => outputLine('held', 'HELD_CMD')))
  await t.waitBuffer(SESSION, 'S_CMD')

  // Shell per terminal.
  check('terminal abre no shell escolhido', await waitFor2(async () => /SHELL=.*cmd\.exe/i.test(await t.bufferText('incmd'))), (await t.bufferText('incmd')).slice(-120))
  await t.clickText('.fw-toolbar button', 'Terminal')
  await sleep(500)
  const options = await js(`[...document.querySelectorAll('.fw-modal select option')].map(o => o.textContent).join('|')`)
  check('diálogo oferece os tipos de terminal instalados', options.includes('PowerShell') && options.includes('cmd'), options)
  await t.clickText('.fw-modal button', 'Cancelar')

  // New version on disk.
  const watched = path.join(S, 'watch.txt')
  fs.writeFileSync(watched, 'versao 2\n')
  check('alteração externa mostra aviso de nova versão', await waitFor(`document.querySelector('${nodeSel('f1')} .fw-file-notice')?.textContent.includes('nova versão')`, 5000))
  check('cabeçalho também indica a nova versão', (await nodeText('f1')).includes('nova versão no disco'))
  check('editor continua na versão antiga até recarregar', (await nodeText('f1')).includes('versao 1'))
  await t.clickText(`${nodeSel('f1')} .fw-file-notice button`, 'Recarregar')
  check('recarregar traz a versão nova e limpa o aviso', await waitFor(`(() => { const n = document.querySelector('${nodeSel('f1')}'); return n.textContent.includes('versao 2') && !n.querySelector('.fw-file-notice') })()`, 3000))

  fs.writeFileSync(watched, 'versao 3\n')
  await t.hook(SESSION, { hook_event_name: 'PostToolUse', session_id: '22222222-2222-4222-8222-222222222222', tool_name: 'Edit', cwd: S, tool_input: { file_path: 'watch.txt' } })
  check('alteração por sessão nomeia a sessão', await waitFor(`document.querySelector('${nodeSel('f1')} .fw-file-notice')?.textContent.includes('"Sessao"')`, 3000))
  check('hook de edição não mexe no status da sessão', !(await js(`!!document.querySelector('${nodeSel(SESSION)} .fw-status')`)))
  await t.clickText(`${nodeSel('f1')} .fw-file-notice button`, 'Recarregar')
  await waitFor(`!document.querySelector('${nodeSel('f1')} .fw-file-notice')`, 3000)

  const typeInEditor = async (id, text) => {
    await js(`document.querySelector('${nodeSel(id)} .cm-content').focus()`)
    await sleep(100)
    await t.type(text)
    await sleep(200)
  }
  await typeInEditor('f1', 'EDITADO ')
  fs.writeFileSync(watched, 'versao 4\n')
  await t.key('s', ['control'])
  check('salvar por cima de versão mais nova pede confirmação', await waitFor(`!!document.querySelector('${nodeSel('f1')} .fw-file-notice.conflict')`, 2000))
  check('sem confirmar, o disco fica como está', fs.readFileSync(watched, 'utf8') === 'versao 4\n', fs.readFileSync(watched, 'utf8'))
  await t.clickText(`${nodeSel('f1')} .fw-file-notice button`, 'Sobrescrever')
  await sleep(400)
  check('"Sobrescrever" grava a versão do editor', fs.readFileSync(watched, 'utf8').includes('EDITADO'), fs.readFileSync(watched, 'utf8'))
  await sleep(2500)
  check('salvar não gera aviso de nova versão', !(await js(`!!document.querySelector('${nodeSel('f1')} .fw-file-notice')`)))

  // .http
  const sendButtons = `${nodeSel('http')} .fw-http-send button`
  await waitFor(`document.querySelectorAll('${sendButtons}').length > 0`, 3000)
  const labels = await js(`[...document.querySelectorAll('${sendButtons}')].map(b => b.textContent).join('|')`)
  check('um botão de envio por requisição, com o nome', labels === '▶ Enviar · Listar|▶ Enviar · criar|▶ Enviar · Quebrada', labels)
  await js(`document.querySelectorAll('${sendButtons}')[0].click()`)
  await waitFor(`document.querySelector('${nodeSel('http')} .fw-http-status')?.textContent.includes('200')`, 5000)
  check('GET substitui as variáveis e envia os headers', received[0]?.url === '/items' && received[0]?.auth === 'Bearer abc', JSON.stringify(received[0]))
  await js(`document.querySelectorAll('${sendButtons}')[1].click()`)
  await waitFor(`document.querySelector('${nodeSel('http')} .fw-http-status')?.textContent.includes('201')`, 5000)
  check('POST escolhido entre vários envia o corpo', received[1]?.method === 'POST' && received[1]?.body === '{"nome": "x"}', JSON.stringify(received[1]))
  check('resposta aparece formatada no nó', (await js(`document.querySelector('${nodeSel('http')} .fw-http-body').textContent`)).includes('"metodo": "POST"'))
  await js(`document.querySelectorAll('${sendButtons}')[2].click()`)
  check('variável indefinida vira erro e nada é enviado', (await waitFor(`document.querySelector('${nodeSel('http')} .fw-http-error')?.textContent.includes('naoExiste')`, 3000)) && received.length === 2)
  await t.shot('http.png')

  // What a session saves for the user.
  check('sem nada guardado, a sessão não mostra o botão da lista', !(await js(`!!document.querySelector('${nodeSel(SESSION)} .fw-panel-toggle')`)))
  await call(SESSION, 'save_snippet', { text: 'npm run migrate -- --force', label: 'migração' })
  await call(SESSION, 'save_snippet', { text: 'npm run migrate -- --force', label: 'migração' })
  const pin = await call(SESSION, 'pin_file', { path: 'pinned.txt', note: 'o principal' })
  check('pin_file aceita caminho relativo à sessão', !pin.isError, pin.content[0].text)
  check('pin_file recusa arquivo inexistente', (await call(SESSION, 'pin_file', { path: 'nada.txt' })).isError === true)
  check('botão da lista aparece com a contagem, sem repetir', await waitFor(`document.querySelector('${nodeSel(SESSION)} .fw-panel-toggle')?.textContent.includes('2')`, 3000))
  await js(`document.querySelector('${nodeSel(SESSION)} .fw-panel-toggle').click()`)
  await sleep(300)
  await t.shot('panel.png')
  if (await t.clipboardUsable()) {
    await js(`document.querySelector('${nodeSel(SESSION)} .fw-panel-item button').click()`)
    await sleep(300)
    const copied = await clipboard.readText()
    check('copiar leva o texto para a área de transferência', copied === 'npm run migrate -- --force', copied)
  } else skip('copiar leva o texto para a área de transferência', 'área de transferência em uso por outro programa')
  await js(`document.querySelector('${nodeSel(SESSION)} .fw-panel-file').click()`)
  check('clicar no arquivo da lista abre no canvas', await waitFor(`[...document.querySelectorAll('.react-flow__node-file .fw-node-title')].some(x => x.textContent.startsWith('pinned.txt'))`, 3000))
  const list = () => t.mcp(SESSION, 'tools/list').then((r) => r.result.tools.map((x) => x.name))
  await js(`window.api.settings.set({ sessionSnippets: false })`)
  check('desligar remove a ferramenta da lista', !(await list()).includes('save_snippet') && (await list()).includes('pin_file'))
  check('desligado, a chamada é recusada', (await call(SESSION, 'save_snippet', { text: 'x' })).isError === true)
  const init = (await t.mcp(SESSION, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } })).result
  check('desligado, as instruções não citam a ferramenta', !init.instructions.includes('save_snippet') && init.instructions.includes('pin_file'))
  check('instruções dizem para usar elementos só a pedido', init.instructions.includes('só use list_elements'))
  const allow = t.hooksFile(SESSION).permissions.allow
  check('ferramentas de elementos não pedem confirmação', allow.includes('mcp__free-workspace__update_todo') && allow.includes('mcp__free-workspace__save_snippet'))

  // Notes and to-do lists connected to a session.
  const listed = (await call(SESSION, 'list_elements')).content[0].text
  check('list_elements mostra só os conectados', listed.includes('"Plano"') && listed.includes('"Lista"') && listed.includes('1/2') && !listed.includes('Solta'), listed)
  check('elemento não conectado é recusado', (await call(SESSION, 'read_element', { element: 'Solta' })).isError === true)
  check('read_element lê a nota', (await call(SESSION, 'read_element', { element: 'Plano' })).content[0].text.includes('passo 1'))
  const todo = (await call(SESSION, 'read_element', { element: 'Lista' })).content[0].text
  check('read_element lê o ToDo com o estado de cada item', todo.includes('- [ ] revisar') && todo.includes('- [x] testar'), todo)
  await call(SESSION, 'write_note', { element: 'Plano', text: 'passo 2' })
  check('write_note acrescenta por padrão', await waitFor(`(() => { const x = document.querySelector('${nodeSel('n1')}').textContent; return x.includes('passo 1') && x.includes('passo 2') })()`, 3000))
  await call(SESSION, 'write_note', { element: 'n1', text: '# Plano\n\nnovo', mode: 'replace' })
  check('write_note com replace troca o texto', await waitFor(`(() => { const x = document.querySelector('${nodeSel('n1')}').textContent; return x.includes('novo') && !x.includes('passo 1') })()`, 3000))
  // In parallel on purpose: each must see the previous one's change.
  await Promise.all([
    call(SESSION, 'update_todo', { element: 'Lista', check: ['revisar'] }),
    call(SESSION, 'update_todo', { element: 'Lista', uncheck: ['i2'] }),
    call(SESSION, 'update_todo', { element: 'Lista', add: ['nova tarefa'] })
  ])
  await sleep(1200) // autosave debounce
  const items = t.canvasFile('test').nodes.find((n) => n.id === 'td').data.items
  check('chamadas simultâneas a update_todo não se sobrescrevem', items.length === 3 && items[0].done === true && items[1].done === false && items[2].text === 'nova tarefa', JSON.stringify(items))
  const wrong = await call(SESSION, 'update_todo', { element: 'Lista', check: ['inexistente'] })
  check('tarefa não encontrada é informada', wrong.content[0].text.includes('inexistente'), wrong.content[0].text)
  check('write_note em ToDo é recusado', (await call(SESSION, 'write_note', { element: 'Lista', text: 'x' })).isError === true)

  // Connecting by dragging.
  await js(`document.querySelector('.react-flow__controls-fitview')?.click()`)
  await sleep(600)
  const dot = (id, side) => t.stableRect(`${nodeSel(id)} .fw-handle[data-handleid="${side}"]`)
  const connect = async (a, b) => {
    const from = await dot(a, 'r')
    const to = await dot(b, 'l')
    await drag(from.x + from.w / 2, from.y + from.h / 2, to.x + to.w / 2, to.y + to.h / 2)
    await sleep(300)
  }
  const edges = () => js(`document.querySelectorAll('.react-flow__edge').length`)
  const before = await edges()
  await connect('n1', 'n2')
  check('duas notas não se conectam', (await edges()) === before)
  await connect('n2', SESSION)
  check('arrastar da nota até a sessão conecta', (await edges()) === before + 1 && (await call(SESSION, 'list_elements')).content[0].text.includes('Solta'))

  // Optional: the real CLI's hook payload and tools (FW_E2E_REAL=1; spends a few tokens).
  if (process.env.FW_E2E_REAL) {
    const { spawn } = require('child_process')
    const hooksDir = path.join(S, 'fwdata', 'hooks')
    const q = (p) => `"${p.replace(/\\/g, '/')}"`
    fs.writeFileSync(watched, 'versao real\n')
    await t.clickText(`${nodeSel('f1')} .fw-file-notice button`, 'Ignorar').catch(() => {})
    await sleep(2500)
    await js(`window.api.settings.set({ sessionSnippets: true })`)
    const prompt = 'Faça, nesta ordem e sem explicar: 1) com a ferramenta Write, sobrescreva o arquivo watch.txt deste diretório com o texto "versao do claude"; 2) chame save_snippet com text "REAL_SNIPPET"; 3) chame update_todo no elemento Lista adicionando "REAL_TAREFA". Depois responda só OK.'
    const child = spawn(`claude -p ${JSON.stringify(prompt)} --model haiku --permission-mode acceptEdits --settings ${q(path.join(hooksDir, SESSION + '.json'))} --mcp-config ${q(path.join(hooksDir, SESSION + '.mcp.json'))}`,
      { cwd: S, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    await Promise.race([new Promise((r) => child.on('close', r)), sleep(120000)])
    check('Claude real: hook de edição nomeia a sessão no arquivo aberto', await waitFor(`document.querySelector('${nodeSel('f1')} .fw-file-notice')?.textContent.includes('"Sessao"')`, 4000), out.trim().slice(-200))
    check('Claude real: save_snippet chega à lista', await waitFor(`document.querySelector('${nodeSel(SESSION)}').textContent.includes('REAL_SNIPPET')`, 3000))
    check('Claude real: update_todo chega ao ToDo', await waitFor(`document.querySelector('${nodeSel('td')}').textContent.includes('REAL_TAREFA')`, 3000))
  }

  server.close()

  async function waitFor2(fn, ms = 8000) {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (await fn()) return true
    return false
  }
}
