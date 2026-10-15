import { useState } from 'react'
import { COLOR_KINDS } from '../../shared/colors'
import { DEFAULT_AGENT_INSTRUCTIONS, type Settings } from '../../shared/settings'

type Props = { settings: Settings; onSave: (s: Settings) => void; onCancel: () => void }

export function SettingsDialog({ settings, onSave, onCancel }: Props) {
  const [s, setS] = useState(settings)
  const set = (patch: Partial<Settings>) => setS((cur) => ({ ...cur, ...patch }))

  return (
    <div className="fw-modal-backdrop" onMouseDown={onCancel}>
      <form
        className="fw-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          onSave(s)
        }}
      >
        <h3>Configurações</h3>
        <label>
          Diretório inicial dos terminais
          <span className="fw-row">
            <input value={s.terminalCwd} placeholder="pasta do usuário" onChange={(e) => set({ terminalCwd: e.target.value })} />
            <button type="button" onClick={async () => set({ terminalCwd: (await window.api.dialog.openDir()) ?? s.terminalCwd })}>
              …
            </button>
          </span>
          <span className="fw-help">Usado quando o workspace não tem diretório próprio.</span>
        </label>
        <label>
          Diretório inicial dos workspaces novos
          <span className="fw-row">
            <input value={s.workspaceCwd} placeholder="nenhum (usa o dos terminais)" onChange={(e) => set({ workspaceCwd: e.target.value })} />
            <button type="button" onClick={async () => set({ workspaceCwd: (await window.api.dialog.openDir()) ?? s.workspaceCwd })}>
              …
            </button>
          </span>
          <span className="fw-help">Todo workspace criado já nasce apontando para cá; dá para trocar depois no clique direito dele.</span>
        </label>
        <label>
          Shell
          <input value={s.shell} placeholder="powershell.exe" list="fw-shells" onChange={(e) => set({ shell: e.target.value })} />
          <datalist id="fw-shells">
            <option value="powershell.exe" />
            <option value="pwsh.exe" />
            <option value="cmd.exe" />
            <option value="C:\Program Files\Git\bin\bash.exe" />
            <option value="wsl.exe" />
          </datalist>
          <span className="fw-help">Vale para terminais novos ou reiniciados.</span>
        </label>
        <label className="fw-check">
          <input type="checkbox" checked={s.composer} onChange={(e) => set({ composer: e.target.checked })} />
          Caixa de texto abaixo do terminal/sessão selecionado (Enter envia, Shift+Enter quebra linha)
        </label>
        <label className="fw-check">
          <input type="checkbox" checked={s.rightDragPan} onChange={(e) => set({ rightDragPan: e.target.checked })} />
          Arrastar o canvas também com o botão direito (clique simples continua abrindo o menu)
        </label>
        <label className="fw-check">
          <input type="checkbox" checked={s.showMinimap} onChange={(e) => set({ showMinimap: e.target.checked })} />
          Mostrar minimapa (canto inferior direito)
        </label>
        <label className="fw-check">
          <input type="checkbox" checked={s.showControls} onChange={(e) => set({ showControls: e.target.checked })} />
          Mostrar controles do canvas (canto inferior esquerdo)
        </label>
        <div className="fw-field">
          Cores por tipo de elemento
          <div className="fw-color-grid">
            {COLOR_KINDS.map(([kind, label]) => {
              const value = s.nodeColors[kind]
              return (
                <label key={kind} className="fw-color-item" data-kind={kind}>
                  <input
                    type="color"
                    value={value ?? '#7aa2f7'}
                    className={value ? '' : 'unset'}
                    onChange={(e) => set({ nodeColors: { ...s.nodeColors, [kind]: e.target.value } })}
                  />
                  {label}
                  {value && (
                    <button type="button" className="fw-link" title="Sem cor" onClick={() => set({ nodeColors: { ...s.nodeColors, [kind]: undefined } })}>
                      ×
                    </button>
                  )}
                </label>
              )
            })}
          </div>
          <span className="fw-help">Cada elemento pode ter a própria cor: clique direito → Cor….</span>
        </div>
        <label>
          Dias na lixeira antes de apagar de vez
          <input type="number" min={1} max={365} value={s.trashDays} onChange={(e) => set({ trashDays: Math.max(1, Number(e.target.value) || 1) })} />
          <span className="fw-help">Workspaces excluídos com "Mover para a lixeira" são apagados ao abrir o app depois desse prazo.</span>
        </label>
        <label className="fw-check">
          <input type="checkbox" checked={s.agentMcp} onChange={(e) => set({ agentMcp: e.target.checked })} />
          Permitir que sessões Claude conectadas no canvas conversem entre si (MCP)
        </label>
        {s.agentMcp && (
          <label>
            Instruções para as sessões
            <textarea
              rows={7}
              value={s.agentInstructions || DEFAULT_AGENT_INSTRUCTIONS}
              onChange={(e) => set({ agentInstructions: e.target.value === DEFAULT_AGENT_INSTRUCTIONS ? '' : e.target.value })}
            />
            <span className="fw-help">
              Entra no contexto de cada sessão ao iniciar ou reiniciar (o nome e o papel de cada uma são acrescentados).{' '}
              {s.agentInstructions && (
                <button type="button" className="fw-link" onClick={() => set({ agentInstructions: '' })}>
                  Restaurar padrão
                </button>
              )}
            </span>
          </label>
        )}
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
