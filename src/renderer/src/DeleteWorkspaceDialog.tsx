import type { Workspace } from './types'

type Props = {
  workspace: Workspace
  trashDays: number
  /** Omitted for a workspace already in the trash: only "delete now" applies. */
  onTrash?: () => void
  onDelete: () => void
  onCancel: () => void
}

export function DeleteWorkspaceDialog({ workspace, trashDays, onTrash, onDelete, onCancel }: Props) {
  return (
    <div className="fw-modal-backdrop" onMouseDown={onCancel}>
      <div className="fw-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Excluir "{workspace.name}"?</h3>
        <p className="fw-help fw-modal-text">
          Apaga o canvas deste workspace: posições, notas, ToDos, conexões e os prints colados. Os terminais dele são
          encerrados. Arquivos e repositórios que aparecem no canvas <strong>não</strong> são tocados.
        </p>
        <div className="fw-row fw-end">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          {onTrash && (
            <button type="button" onClick={onTrash}>
              Mover para a lixeira ({trashDays} {trashDays === 1 ? 'dia' : 'dias'})
            </button>
          )}
          <button type="button" className="danger" onClick={onDelete}>
            Excluir agora
          </button>
        </div>
      </div>
    </div>
  )
}
