import { useEffect, useState } from 'react'
import type { TerminalData } from './types'

type Props = {
  kind: TerminalData['kind']
  /** Workspace directory, else the global setting; empty falls back to the home folder. */
  defaultCwd?: string
  onCancel: () => void
  onCreate: (data: TerminalData) => void
}

export function TerminalDialog({ kind, defaultCwd, onCancel, onCreate }: Props) {
  const ai = kind === 'ai'
  const [title, setTitle] = useState(ai ? 'Claude' : 'Terminal')
  const [cwd, setCwd] = useState(defaultCwd ?? '')
  const [provider, setProvider] = useState<'claude' | 'custom'>('claude')
  const [command, setCommand] = useState(ai ? 'claude' : '')
  const [resumeCommand, setResumeCommand] = useState('')
  const [worktree, setWorktree] = useState(false)
  const [branch, setBranch] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.homedir().then((h) => setCwd((c) => c || h))
  }, [])

  const pickProvider = (p: 'claude' | 'custom') => {
    setProvider(p)
    setCommand(p === 'claude' ? 'claude' : '')
    setTitle(p === 'claude' ? 'Claude' : 'Sessão IA')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    let dir = cwd
    if (worktree) {
      setBusy(true)
      try {
        dir = await window.api.git.addWorktree(cwd, branch.trim())
      } catch (err) {
        setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
        return
      } finally {
        setBusy(false)
      }
    }
    onCreate({
      kind,
      title: worktree && (title === 'Claude' || title === 'Terminal' || title === 'Sessão IA') ? branch.trim() : title,
      cwd: dir,
      command: command || undefined,
      ...(ai ? { provider, resumeCommand: provider === 'custom' ? resumeCommand || undefined : undefined } : {})
    })
  }

  return (
    <div className="fw-modal-backdrop" onMouseDown={onCancel}>
      <form className="fw-modal" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{ai ? 'Nova sessão de IA' : 'Novo terminal'}</h3>
        {ai && (
          <label>
            Provedor
            <select value={provider} onChange={(e) => pickProvider(e.target.value as 'claude' | 'custom')}>
              <option value="claude">Claude Code</option>
              <option value="custom">Outro (comandos manuais)</option>
            </select>
          </label>
        )}
        <label>
          Nome
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          {worktree ? 'Repositório' : 'Diretório'}
          <span className="fw-row">
            <input value={cwd} onChange={(e) => setCwd(e.target.value)} />
            <button type="button" onClick={async () => setCwd((await window.api.dialog.openDir(cwd)) ?? cwd)}>
              …
            </button>
          </span>
        </label>
        <label className="fw-check">
          <input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} />
          Abrir numa worktree git nova
        </label>
        {worktree && (
          <label>
            Branch
            <input required value={branch} placeholder="ex.: feat/login" onChange={(e) => setBranch(e.target.value)} />
            <span className="fw-help">
              Cria a pasta <code>&lt;repo&gt;.worktrees/&lt;branch&gt;</code> ao lado do repositório (a branch é criada se não
              existir). Remover a worktree depois é pelo terminal: <code>git worktree remove</code>.
            </span>
          </label>
        )}
        <label>
          Comando inicial {!ai && <span className="fw-muted">(opcional)</span>}
          <input value={command} required={ai} placeholder={ai ? 'ex.: codex' : 'ex.: ngrok http 3000'} onChange={(e) => setCommand(e.target.value)} />
          {ai && provider === 'claude' && (
            <span className="fw-help">
              Ao reabrir o workspace, a sessão volta na última conversa usada neste terminal. Pode acrescentar flags
              (ex.: <code>claude --model opus</code>).
            </span>
          )}
        </label>
        {ai && provider === 'custom' && (
          <label>
            Comando ao reabrir <span className="fw-muted">(opcional)</span>
            <input value={resumeCommand} placeholder="ex.: codex resume --last" onChange={(e) => setResumeCommand(e.target.value)} />
            <span className="fw-help">Sem ele, o comando inicial roda de novo e abre uma conversa nova.</span>
          </label>
        )}
        {error && <div className="fw-error fw-modal-error">{error}</div>}
        <div className="fw-row fw-end">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Criando…' : 'Criar'}
          </button>
        </div>
      </form>
    </div>
  )
}
