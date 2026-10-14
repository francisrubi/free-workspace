import type { Terminal } from '@xterm/xterm'

/** Live xterm instances by node id, so menus outside the node can copy/paste/clear/restart. */
type Entry = { term: Terminal; restart: () => void }
export const terminals = new Map<string, Entry>()
if (window.api.isTest) Object.assign(window, { __fwTerminals: terminals })

export async function copySelection(term: Terminal): Promise<boolean> {
  const text = term.getSelection()
  if (!text) return false
  await window.api.clipboard.writeText(text)
  term.clearSelection()
  return true
}

export async function pasteInto(term: Terminal): Promise<void> {
  const text = await window.api.clipboard.readText()
  if (text) term.paste(text)
}
