/**
 * Closing the window while terminals run must not throw in the main process (it used to:
 * PTYs kept emitting data/exit after the window was destroyed). Records uncaught exceptions
 * to FW_E2E_DIR/close-errors.json; run-e2e.mjs checks the file after the app exits.
 */
const fs = require('fs')
const path = require('path')

const out = path.join(process.env.FW_E2E_DIR, 'close-errors.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

module.exports = async (win) => {
  const errors = []
  fs.writeFileSync(out, '[]')
  // Replaces Electron's default handler (the error dialog), so the run can't hang on it.
  process.on('uncaughtException', (e) => {
    errors.push(String(e && e.stack ? e.stack : e))
    fs.writeFileSync(out, JSON.stringify(errors, null, 2))
  })
  const js = (code) => win.webContents.executeJavaScript(code)
  win.webContents.setBackgroundThrottling(false)
  await sleep(1500)
  await js(`[...document.querySelectorAll('.fw-ws')].find(b => b.textContent.includes('Teste')).click()`)
  // Wait until several terminals are up and printing, then close like the user does.
  for (let i = 0; i < 50 && (await js(`document.querySelectorAll('.xterm').length`)) < 3; i++) await sleep(200)
  await sleep(2500)
  win.close()
  await sleep(3000) // the app normally quits on its own before this ends
}
