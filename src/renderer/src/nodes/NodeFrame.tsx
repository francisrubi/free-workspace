import { NodeResizer, useNodesData, useReactFlow } from '@xyflow/react'
import { nodeColor } from '../../../shared/colors'
import { useState, type ReactNode } from 'react'
import { useCanvas, useSettings, useStack } from '../context'

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
  const { tabsOf, activate, detach } = useStack()
  const tabs = tabsOf.get(id)
  const [error, setError] = useState('')
  const renaming = renamingId === id
  const node = useNodesData(id)
  const { nodeColors } = useSettings()
  const color = node ? nodeColor(node.type, node.data, nodeColors) : undefined

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
    <div
      className={`fw-node${selected ? ' selected' : ''}${color ? ' colored' : ''}`}
      style={color ? ({ '--node-color': color } as React.CSSProperties) : undefined}
    >
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
        ) : tabs ? (
          <span className="fw-tabs nodrag">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                data-tab={t.id}
                className={`fw-tab${t.active ? ' active' : ''}`}
                style={t.color ? ({ '--tab-color': t.color } as React.CSSProperties) : undefined}
                title={`${t.title} · arraste para fora do cabeçalho para separar`}
                onClick={() => !t.active && activate(t.id)}
                onDoubleClick={() => t.active && setRenamingId(t.id)}
                // Dragging a tab out of the header takes it out of the group, dropped where released.
                onPointerDown={(e) => {
                  const header = e.currentTarget.closest('.fw-node-header')!.getBoundingClientRect()
                  const up = (ev: PointerEvent) => {
                    window.removeEventListener('pointerup', up)
                    const out = ev.clientY < header.top - 20 || ev.clientY > header.bottom + 20 || ev.clientX < header.left - 20 || ev.clientX > header.right + 20
                    if (out) detach(t.id, ev.clientX, ev.clientY)
                  }
                  window.addEventListener('pointerup', up)
                }}
              >
                <span className="fw-tab-icon">{t.icon}</span>
                {t.title}
              </button>
            ))}
          </span>
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
