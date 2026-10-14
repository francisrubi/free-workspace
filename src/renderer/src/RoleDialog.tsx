import { useState } from 'react'
import type { FwNode } from './types'

type Props = { node?: FwNode; onSave: (role: string) => void; onCancel: () => void }

/** What a session is for. Connected sessions see it when they list who they can talk to. */
export function RoleDialog({ node, onSave, onCancel }: Props) {
  const [role, setRole] = useState(node?.type === 'terminal' ? (node.data.role ?? '') : '')
  if (node?.type !== 'terminal') return null
  return (
    <div className="fw-modal-backdrop" onMouseDown={onCancel}>
      <form
        className="fw-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          onSave(role.trim())
        }}
      >
        <h3>Papel de "{node.data.title}"</h3>
        <label>
          O que esta sessão faz
          <textarea autoFocus rows={4} value={role} placeholder="ex.: cuida do backend NestJS; dona do contrato da API" onChange={(e) => setRole(e.target.value)} />
          <span className="fw-help">
            As sessões conectadas a esta veem o papel ao listar com quem podem falar, e a própria sessão o recebe nas
            instruções quando é iniciada ou reiniciada.
          </span>
        </label>
        <div className="fw-row fw-end">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="primary">
            Salvar
          </button>
        </div>
      </form>
    </div>
  )
}
