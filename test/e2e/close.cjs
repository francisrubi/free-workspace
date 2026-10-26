/**
 * Closing the window while terminals run: no exception in the main process (PTYs kept
 * emitting after the window was destroyed), no lost change made just before closing (the
 * autosave is debounced), and the process actually ends (ConPTY could hang it). The last two
 * are checked by run.mjs after the app exits; this script records what it needs for them.
 */
const fs = require('fs')
const path = require('path')
const harness = require('./harness.cjs')

module.exports = async (win) => {
  const t = harness(win)
  const errors = []
  const out = path.join(t.S, 'close-errors.json')
  fs.writeFileSync(out, '[]')
  // Replaces Electron's default handler (the error dialog), so the run can't hang on it.
  // Written on each one: the process may end before this script gets to run again.
  process.on('uncaughtException', (e) => {
    errors.push(String(e && e.stack ? e.stack : e))
    fs.writeFileSync(out, JSON.stringify(errors, null, 2))
  })
  await t.start()
  await t.openWorkspace('Teste')
  for (let i = 0; i < 50 && (await t.js(`document.querySelectorAll('.xterm').length`)) < 3; i++) await t.sleep(200)
  await t.sleep(2500)
  const before = await t.js(`document.querySelectorAll('.fw-canvas-slot:not(.fw-hidden) .react-flow__node').length`)
  fs.writeFileSync(path.join(t.S, 'close-state.json'), JSON.stringify({ before }))
  // A change inside the autosave debounce, then close right away.
  await t.clickText('.fw-toolbar button', 'Nota')
  win.close()
  await t.sleep(3000) // the app normally quits on its own before this ends
}
