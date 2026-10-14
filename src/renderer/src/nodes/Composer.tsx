import { useLayoutEffect, useRef, useState } from 'react'
import { terminals } from '../terminals'

type Props = { nodeId: string; visible: boolean }

/**
 * A text box under a terminal/session for writing prompts comfortably: Enter sends,
 * Shift+Enter breaks the line, ↑ on an empty box recalls what was sent. It sits outside the
 * terminal, so it stays put whatever the terminal scrolls to. Shown while the node is
 * selected, and kept while it holds a draft or has focus.
 */
export function Composer({ nodeId, visible }: Props) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const history = useRef<string[]>([])
  const recall = useRef(-1)

  // Grow with the content, up to the CSS max-height (then it scrolls).
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text, visible, focused])

  if (!visible && !focused && !text) return null

  const send = () => {
    const t = terminals.get(nodeId)
    if (!t || !text.trim()) return
    // paste() wraps the text in bracketed-paste markers when the program asked for them (Claude
    // Code, PSReadLine), so line breaks arrive as part of one message instead of as Enters.
    t.term.paste(text)
    // Enter separately, or a TUI takes it as part of the paste.
    setTimeout(() => window.api.pty.write(nodeId, '\r'), 200)
    history.current = [text, ...history.current.filter((h) => h !== text)].slice(0, 50)
    recall.current = -1
    setText('')
  }

  return (
    <div className="fw-composer nodrag nowheel">
      <textarea
        ref={box}
        rows={1}
        value={text}
        placeholder="Escreva aqui · Enter envia · Shift+Enter quebra linha · Esc volta ao terminal"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          recall.current = -1
          setText(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          } else if (e.key === 'Escape') {
            terminals.get(nodeId)?.term.focus()
          } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (!text || recall.current >= 0)) {
            const next = recall.current + (e.key === 'ArrowUp' ? 1 : -1)
            if (next < -1 || next >= history.current.length) return
            e.preventDefault()
            recall.current = next
            setText(next === -1 ? '' : history.current[next])
          }
        }}
      />
      <button title="Enviar (Enter)" disabled={!text.trim()} onMouseDown={(e) => e.preventDefault()} onClick={send}>
        ↵
      </button>
    </div>
  )
}
