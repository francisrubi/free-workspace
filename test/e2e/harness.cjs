/**
 * Helpers shared by the e2e modules. A module is a script the app loads through its FW_TEST
 * hook (src/main): `module.exports = async (win) => { const t = harness(win); … }`. It drives
 * the real window with trusted input events (sendInputEvent) and records each check, as it
 * goes, in FW_E2E_DIR/results.json for run.mjs.
 */
const { clipboard } = require('electron')
const fs = require('fs')
const path = require('path')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

module.exports = function harness(win) {
  const S = process.env.FW_E2E_DIR
  const resultsFile = path.join(S, 'results.json')
  const results = []
  const record = (status, name, extra = '') => {
    const line = `${status}  ${name}${extra ? '  — ' + extra : ''}`
    results.push({ status, name, extra })
    console.log(line)
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2))
  }
  const check = (name, ok, extra = '') => record(ok ? 'PASS' : 'FAIL', name, extra)
  // The system clipboard is shared: another program (or the user) using it mid-run makes the
  // clipboard checks meaningless, so they are skipped — and say so — instead of failing.
  const skip = (name, why) => record('SKIP', name, why)

  const wc = win.webContents
  const js = (code) => wc.executeJavaScript(code)
  const mouse = (type, x, y, button = 'left', clickCount = 1) => wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button, clickCount })
  const t = {
    S,
    sleep,
    check,
    skip,
    js,
    mouse,
    shot: async (name) => fs.writeFileSync(path.join(S, name), (await wc.capturePage()).toPNG()),
    click: async (x, y, button = 'left') => {
      mouse('mouseDown', x, y, button)
      mouse('mouseUp', x, y, button)
      await sleep(150)
    },
    drag: async (x1, y1, x2, y2, button = 'left') => {
      mouse('mouseDown', x1, y1, button)
      for (let i = 1; i <= 8; i++) {
        mouse('mouseMove', x1 + ((x2 - x1) * i) / 8, y1 + ((y2 - y1) * i) / 8, button)
        await sleep(20)
      }
      mouse('mouseUp', x2, y2, button)
      await sleep(200)
    },
    key: async (keyCode, modifiers = []) => {
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
      await sleep(100)
    },
    type: async (text) => {
      for (const c of text) wc.sendInputEvent({ type: 'char', keyCode: c })
      await sleep(100)
    },
    waitFor: async (code, ms = 15000) => {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (await js(code)) return true
      return false
    },
    rect: (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height } })()`),
    clickText: (sel, text) =>
      js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.includes(${JSON.stringify(text)})); b?.click(); return !!b })()`),
    // Whole xterm buffer of a node (exposed in test mode): what the terminal received,
    // independent of DOM painting. A wrapped row continues the previous line.
    bufferText: (id) =>
      js(`(() => { const t = window.__fwTerminals.get(${JSON.stringify(id)}); if (!t) return ''
        const b = t.term.buffer.active; const out = []
        for (let i = 0; i < b.length; i++) { const l = b.getLine(i); const s = l.translateToString(true); if (l.isWrapped && out.length) out[out.length - 1] += s; else out.push(s) }
        return out.join('\\n') })()`),
    // React-controlled inputs only see a value set through the native setter + an input event.
    setInput: (sel, value) =>
      js(`(() => { const el = document.querySelector(${JSON.stringify(sel)})
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)})
        el.dispatchEvent(new Event('input', { bubbles: true })) })()`),
    contextMenuOn: (sel) =>
      js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const r = el.getBoundingClientRect()
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 5, clientY: r.y + 5 })) })()`),
    /** Opens a node's context menu and clicks the item containing `label`. */
    // Retries: menus close when the window loses focus, which happens if someone uses the
    // machine while the tests run.
    menu: async (nodeId, label) => {
      for (let i = 0; i < 3; i++) {
        await t.contextMenuOn(`.react-flow__node[data-id="${nodeId}"] .fw-node-header`)
        await sleep(200)
        if (await t.clickText('.fw-menu button', label)) {
          await sleep(200)
          return true
        }
      }
      return false
    },
    openWorkspace: async (name) => {
      await t.clickText('.fw-ws', name)
      await sleep(800)
    },
    /** Writes a random value and reads it back: false if another program holds the clipboard. */
    clipboardUsable: async () => {
      const probe = `fw-probe-${Math.random().toString(36).slice(2)}`
      await clipboard.writeText(probe)
      await sleep(50)
      return (await clipboard.readText()) === probe
    },
    canvasFile: (ws) => JSON.parse(fs.readFileSync(path.join(S, 'fwdata', 'workspaces', ws, 'canvas.json'), 'utf8')),
    hooksFile: (id) => JSON.parse(fs.readFileSync(path.join(S, 'fwdata', 'hooks', id + '.json'), 'utf8')),
    hookUrl: (id) => t.hooksFile(id).hooks.Stop[0].hooks[0].url,
    /** Plays a Claude Code hook event for a session node. */
    hook: (id, payload) => fetch(t.hookUrl(id), { method: 'POST', body: JSON.stringify(payload) })
  }
  // Position of an element once it stops moving (e.g. after an animated fit view).
  t.stableRect = async (sel) => {
    let prev = null
    for (let i = 0; i < 20; i++) {
      const r = await t.rect(sel)
      if (prev && r && r.x === prev.x && r.y === prev.y && r.w === prev.w) return r
      prev = r
      await sleep(100)
    }
    return prev
  }
  /** Waits until a node's terminal buffer contains `text`. */
  t.waitBuffer = async (id, text, ms = 10000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if ((await t.bufferText(id)).includes(text)) return true
    return false
  }

  // MCP client for a session node: JSON answers, or SSE for the blocking ask_session.
  let rpcId = 0
  t.mcp = async (id, method, params = {}) => {
    const url = JSON.parse(fs.readFileSync(path.join(S, 'fwdata', 'hooks', id + '.mcp.json'), 'utf8')).mcpServers['free-workspace'].url
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })
    })
    const body = await r.text()
    return JSON.parse(body.startsWith('{') ? body : body.split('\n').find((l) => l.startsWith('data: ')).slice(6))
  }
  t.call = async (id, name, args = {}) => (await t.mcp(id, 'tools/call', { name, arguments: args })).result

  /** Common start: window ready, rAF not throttled when the test window is covered. */
  t.start = async () => {
    win.focus()
    wc.setBackgroundThrottling(false)
    await sleep(1500)
  }
  return t
}
