import type { Workspace } from './types'

type Props = {
  nodeTitle: string
  /** Other live workspaces, with whether each is loaded. */
  targets: (Workspace & { open: boolean })[]
  onPick: (workspaceId: string) => void
  onCancel: () => void
}

export function MoveDialog({ nodeTitle, targets, onPick, onCancel }: Props) {
  return (
    <div className="fw-modal-backdrop" onMouseDown={onCancel}>
      <div className="fw-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Mover "{nodeTitle}" para…</h3>
        {targets.length ? (
          <div className="fw-move-list">
            {targets.map((w) => (
              <button key={w.id} type="button" className="fw-ws" data-ws={w.id} onClick={() => onPick(w.id)}>
                <span className={`fw-ws-dot${w.open ? ' on' : ''}`} />
                {w.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="fw-help fw-modal-text">Não há outro workspace. Crie um na barra lateral.</p>
        )}
        <p className="fw-help fw-modal-text">
          Terminais e sessões continuam rodando: nada é reiniciado. Conexões com sessões deste workspace são desfeitas.
        </p>
        <div className="fw-row fw-end">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
