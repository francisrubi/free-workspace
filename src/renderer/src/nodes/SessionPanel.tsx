import { useReactFlow } from '@xyflow/react'
import { useState } from 'react'
import { useCanvas } from '../context'
import type { TerminalData } from '../types'

/** What a session saved for the user (MCP save_snippet and pin_file), over its terminal. */
export function SessionPanel({ id, data }: { id: string; data: TerminalData }) {
  const { updateNodeData } = useReactFlow()
  const { openPath } = useCanvas()
  const [copied, setCopied] = useState<string | null>(null)
  const snippets = data.snippets ?? []
  const pinned = data.pinned ?? []

  const copy = async (itemId: string, text: string) => {
    await window.api.clipboard.writeText(text)
    setCopied(itemId)
    setTimeout(() => setCopied((c) => (c === itemId ? null : c)), 1200)
  }

  return (
    <div className="fw-session-panel">
      {snippets.length > 0 && <div className="fw-panel-head">Para copiar</div>}
      {snippets.map((s) => (
        <div key={s.id} className="fw-panel-item" data-snippet={s.id}>
          <div className="fw-panel-main">
            {s.label && <div className="fw-muted">{s.label}</div>}
            <code>{s.text}</code>
          </div>
          <button title="Copiar" onClick={() => copy(s.id, s.text)}>
            {copied === s.id ? '✓' : 'copiar'}
          </button>
          <button title="Tirar da lista" onClick={() => updateNodeData(id, { snippets: snippets.filter((x) => x.id !== s.id) })}>
            ×
          </button>
        </div>
      ))}
      {pinned.length > 0 && <div className="fw-panel-head">Arquivos alterados</div>}
      {pinned.map((f) => (
        <div key={f.path} className="fw-panel-item">
          <button className="fw-panel-file" title={f.path} onClick={() => openPath(f.path, id)}>
            <span>📄 {f.path.split(/[\\/]/).pop()}</span>
            {f.note && <span className="fw-muted">{f.note}</span>}
          </button>
          <button title="Tirar da lista" onClick={() => updateNodeData(id, { pinned: pinned.filter((x) => x.path !== f.path) })}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
