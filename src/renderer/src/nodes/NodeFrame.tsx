import { NodeResizer, useReactFlow } from '@xyflow/react'
import { useState, type ReactNode } from 'react'
import { useCanvas } from '../context'

type Props = {
  id: string
  selected?: boolean
  title: string
  /** Muted text after the title (e.g. a path). */
  subtitle?: string
  icon: string
  /** Agent activity dot next to the icon. */
  status?: 'working' | 'idle'
  actions?: ReactNode
  children: ReactNode
  /** Defaults to storing `data.title`. Throw to reject the name (the message is shown). */
  onRename?: (name: string) => void | Promise<void>
  minWidth?: number
  minHeight?: number
}

/**
 * Shared chrome for every canvas element: the header is the only drag handle, and the
 * body is `nodrag nowheel` so typing, selecting text and scrolling inside a terminal or
 * editor never move the canvas. Double-click the title (or "Renomear" in the menu) to rename.
 */
export function NodeFrame({ id, selected, title, subtitle, icon, status, actions, children, onRename, minWidth = 200, minHeight = 120 }: Props) {
  const { deleteElements, updateNodeData } = useReactFlow()
  const { renamingId, setRenamingId } = useCanvas()
  const [error, setError] = useState('')
  const renaming = renamingId === id

  const commit = async (value: string) => {
    const name = value.trim()
    if (name && name !== title) {
      try {
        await (onRename ? onRename(name) : updateNodeData(id, { title: name }))
      } catch (e) {
        setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
        return
      }
    }
    setError('')
    setRenamingId(null)
  }

  return (
    <div className={`fw-node${selected ? ' selected' : ''}`}>
      <NodeResizer isVisible={!!selected} minWidth={minWidth} minHeight={minHeight} lineClassName="fw-resize-line" handleClassName="fw-resize-handle" />
      <div className="fw-node-header fw-drag">
        <span className="fw-node-icon">{icon}</span>
        {status && <span className={`fw-status ${status}`} title={status === 'working' ? 'Trabalhando' : 'Ociosa'} />}
        {renaming ? (
          <input
            className="fw-title-input nodrag"
            autoFocus
            defaultValue={title}
            title={error}
            aria-invalid={!!error}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(e.currentTarget.value)
              if (e.key === 'Escape') {
                setError('')
                setRenamingId(null)
              }
            }}
          />
        ) : (
          <span className="fw-node-title" onDoubleClick={() => setRenamingId(id)} title="Duplo clique para renomear">
            {title}
            {subtitle && <span className="fw-muted"> · {subtitle}</span>}
          </span>
        )}
        <span className="fw-node-actions nodrag">
          {actions}
          <button title="Remover do canvas" onClick={() => deleteElements({ nodes: [{ id }] })}>
            ×
          </button>
        </span>
      </div>
      {error && <div className="fw-node-error">{error}</div>}
      <div className="fw-node-body nodrag nowheel">{children}</div>
    </div>
  )
}
