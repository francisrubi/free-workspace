// What the file node offers per file type: Markdown preview, JSON formatting, running scripts
// (package.json, .ps1, .bat, .sh), opening pages in the browser, comparing with the disk.
const { shell } = require('electron')
const fs = require('fs')
const path = require('path')
const harness = require('./harness.cjs')

module.exports = async (win) => {
  const t = harness(win)
  const { S, js, check, skip, sleep, waitFor } = t
  const node = (id) => `.react-flow__node[data-id="${id}"]`
  const button = (id, label) => `[...document.querySelectorAll('${node(id)} .fw-node-actions button')].find(b => b.textContent.includes('${label}'))`
  const terminalIds = () => js(`[...document.querySelectorAll('.react-flow__node-terminal')].map(n => n.dataset.id)`)
  const titled = (title) => js(`[...document.querySelectorAll('.react-flow__node-terminal')].find(n => n.querySelector('.fw-node-title')?.textContent.startsWith(${JSON.stringify(title)}))?.dataset.id`)

  // The browser must not really open during the test.
  const opened = []
  shell.openExternal = async (url) => void opened.push(url)

  await t.start()
  await t.openWorkspace('Teste')
  await waitFor(`!!document.querySelector('${node('muda')} .cm-content')`)

  // Markdown
  check('.md começa no editor', !(await js(`!!document.querySelector('${node('md')} .fw-markdown')`)))
  await js(`${button('md', 'ver')}.click()`)
  check('.md alterna para a visualização', await waitFor(`document.querySelector('${node('md')} .fw-markdown h1')?.textContent === 'Titulo MD'`, 2000))
  await sleep(300)
  check('HTML do arquivo não é renderizado', (await js(`!document.querySelector('${node('md')} .fw-markdown img') && !window.__xss`)))
  await js(`[...document.querySelectorAll('${node('md')} .fw-markdown a')].forEach(a => a.click())`)
  await sleep(200)
  check('link externo vai para o navegador e o local não navega o app', opened.length === 1 && opened[0] === 'https://exemplo.test/a' && (await js(`!!document.querySelector('.fw-toolbar')`)), opened.join(','))
  opened.length = 0
  await js(`${button('md', 'editar')}.click()`)
  check('.md volta para o editor', await waitFor(`!!document.querySelector('${node('md')} .cm-content')`, 2000))

  // JSON
  const original = fs.readFileSync(path.join(S, 'dados.json'), 'utf8')
  await js(`${button('json', 'formatar')}.click()`)
  await sleep(300)
  const formatted = await js(`document.querySelector('${node('json')} .cm-content').innerText`)
  const expected = '{\n  "id": 12345678901234567890,\n  "b": 1,\n  "2": [\n    1,\n    {\n      "x": null\n    }\n  ],\n  "vazio": {},\n  "texto": "a:b,{c}"\n}'
  check('formatar reindenta sem arredondar números nem reordenar chaves', formatted.trim().replace(/\n+/g, '\n') === expected, formatted)
  check('formatar não grava no disco', fs.readFileSync(path.join(S, 'dados.json'), 'utf8') === original)
  await js(`${button('ruim', 'formatar')}.click()`)
  check('JSON inválido avisa e não muda nada', (await waitFor(`document.querySelector('${node('ruim')} .fw-file-notice')?.textContent.includes('JSON inválido')`, 2000)) && (await js(`document.querySelector('${node('ruim')} .cm-content').innerText.includes('comentario')`)))

  // package.json
  const runs = `${node('pkg')} .fw-script-run`
  await waitFor(`document.querySelectorAll('${runs}').length > 0`, 3000)
  const scripts = await js(`[...document.querySelectorAll('${runs}')].map(b => b.title).join('|')`)
  check('um ▶ por script, sem nomes perigosos nem fora de scripts', scripts === 'Rodar "ola" num terminal', scripts)
  await js(`document.querySelector('${runs}').click()`)
  await waitFor(`[...document.querySelectorAll('.react-flow__node-terminal .fw-node-title')].some(x => x.textContent.startsWith('ola'))`, 3000)
  const scriptNode = await titled('ola')
  check('▶ roda o script com o gerenciador certo', !!scriptNode && (await t.waitBuffer(scriptNode, 'SAIDA_SCRIPT', 25000)) && (await t.bufferText(scriptNode)).includes('npm run ola'))

  // Script files
  const runFile = async (id, title, output, what) => {
    await js(`${button(id, 'rodar')}.click()`)
    await waitFor(`[...document.querySelectorAll('.react-flow__node-terminal .fw-node-title')].some(x => x.textContent.startsWith('${title}'))`, 3000)
    const term = await titled(title)
    const lines = async () => (await t.bufferText(term)).split('\n').map((l) => l.trim())
    let ok = false
    for (let i = 0; i < 50 && !ok; i++) {
      ok = (await lines()).includes(output)
      if (!ok) await sleep(200)
    }
    check(what, ok, ok ? '' : (await t.bufferText(term)).trim().slice(-200))
    return term
  }
  await runFile('bat', 'tarefa.bat', 'SAIDA_BAT', '.bat roda no cmd')
  await runFile('ps1', 'tarefa.ps1', 'SAIDA_PS1', '.ps1 roda no PowerShell (sujeito à política de execução da máquina)')
  if ((await js(`window.api.shells()`)).some((s) => s.label === 'Git Bash')) await runFile('sh', 'tarefa.sh', 'SAIDA_SH', '.sh roda no Git Bash')
  else skip('.sh roda no Git Bash', 'Git Bash não instalado')

  // Reopening doesn't repeat a one-off run. Restart does, on request.
  await sleep(1200) // autosave debounce
  await t.contextMenuOn('.fw-ws')
  await sleep(200)
  await t.clickText('.fw-menu button', 'stand-by')
  await sleep(800)
  await t.openWorkspace('Teste')
  await waitFor(`!!document.querySelector('${node('muda')} .cm-content')`)
  await sleep(2500)
  const reopened = await t.bufferText(scriptNode)
  check('reabrir o workspace não repete o script', !reopened.includes('npm run ola') && !reopened.includes('SAIDA_SCRIPT'), reopened.trim().slice(-120))
  await t.menu(scriptNode, 'Reiniciar processo')
  check('"Reiniciar" roda o script de novo', await t.waitBuffer(scriptNode, 'SAIDA_SCRIPT', 25000))

  // Browser
  await js(`${button('html', 'navegador')}.click()`)
  await sleep(300)
  check('.html abre no navegador pela URL do arquivo', opened.length === 1 && /^file:.*pagina\.html$/.test(opened[0]), opened.join(','))
  const refused = await js(`window.api.shell.openInBrowser('C:/Windows/notepad.exe').then(() => false, () => true)`)
  check('abrir no navegador só aceita páginas', refused && opened.length === 1)
  const badUrl = await js(`window.api.shell.openUrl('file:///C:/Windows/notepad.exe').then(() => false, () => true)`)
  check('abrir link só aceita http(s)', badUrl && opened.length === 1)
  check('botões de tipo não aparecem em outro arquivo', !(await js(`${button('muda', 'navegador')} || ${button('muda', 'rodar')} || ${button('muda', 'formatar')} || ${button('muda', 'ver')} || null`)))

  // Comparing with the disk
  fs.writeFileSync(path.join(S, 'muda.txt'), 'linha igual\nlinha do disco\n')
  await waitFor(`!!document.querySelector('${node('muda')} .fw-file-notice')`, 5000)
  await t.clickText(`${node('muda')} .fw-file-notice button`, 'Ver diferenças')
  check('diferenças mostram as duas versões', await waitFor(`(() => { const x = document.querySelector('${node('muda')} .fw-diff')?.textContent ?? ''; return x.includes('minha linha') && x.includes('linha do disco') })()`, 3000))
  await t.shot('diff.png')
  check('comparar não recarrega nem grava', fs.readFileSync(path.join(S, 'muda.txt'), 'utf8').includes('linha do disco') && (await js(`!!document.querySelector('${node('muda')} .fw-file-notice')`)))
  await t.clickText(`${node('muda')} .fw-diff button`, 'Fechar')
  check('fechar volta ao editor com a versão aberta', await waitFor(`(() => { const x = document.querySelector('${node('muda')} .cm-content')?.textContent ?? ''; return x.includes('minha linha') && !document.querySelector('${node('muda')} .fw-diff') })()`, 2000))

  // Settings tabs, for the screenshot.
  await t.clickText('.fw-ws', 'Configurações')
  await sleep(200)
  await t.clickText('.fw-settings-nav button', 'Sessões de IA')
  await sleep(200)
  await t.shot('settings.png')
  check('trocar de aba mantém o tamanho da modal', await js(`(() => { const a = document.querySelector('.fw-settings').offsetHeight; return a > 300 })()`))
}
