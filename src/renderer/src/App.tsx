import { ReactFlowProvider } from '@xyflow/react'
import { useEffect, useState } from 'react'
import type { Settings } from '../../shared/settings'
import { Canvas } from './Canvas'
import { useContextMenu } from './ContextMenu'
import { SettingsContext } from './context'
import { DeleteWorkspaceDialog } from './DeleteWorkspaceDialog'
import { SettingsDialog } from './SettingsDialog'
import type { Workspace } from './types'
import { WorkspaceList } from './WorkspaceList'

const DAY = 86_400_000

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  // Workspaces start on stand-by: nothing loads (no terminals spawn) until you open one.
  // Once opened it stays mounted in the background until put back on stand-by.
  const [opened, setOpened] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [editingSettings, setEditingSettings] = useState(false)
  const [deleting, setDeleting] = useState<Workspace | null>(null)
  const [showTrash, setShowTrash] = useState(false)
  const [menu, openMenu] = useContextMenu()

  useEffect(() => {
    window.api.ws.list().then(setWorkspaces)
    window.api.settings.get().then(setSettings)
  }, [])

  const live = workspaces.filter((w) => !w.deletedAt)
  const trash = workspaces.filter((w) => w.deletedAt)

  const open = (id: string) => {
    setOpened((o) => (o.includes(id) ? o : [...o, id]))
    setActive(id)
  }
  const standBy = (id: string) => {
    window.api.pty.killWorkspace(id)
    setOpened((o) => o.filter((x) => x !== id))
    if (active === id) setActive(null)
  }
  const create = async () => {
    const ws: Workspace = await window.api.ws.create('Novo workspace')
    setWorkspaces((l) => [...l, ws])
    open(ws.id)
    setRenaming(ws.id)
  }
  const update = (id: string, patch: Partial<Workspace>) => {
    setWorkspaces((l) => l.map((w) => (w.id === id ? { ...w, ...patch } : w)))
    window.api.ws.update(id, patch)
  }
  const moveToTrash = (id: string) => {
    standBy(id)
    update(id, { deletedAt: new Date().toISOString() })
  }
  const deleteNow = async (id: string) => {
    standBy(id)
    await window.api.ws.delete(id)
    setWorkspaces((l) => l.filter((w) => w.id !== id))
  }

  const workspaceMenu = (e: React.MouseEvent, w: Workspace) =>
    openMenu(e, [
      opened.includes(w.id)
        ? { label: 'Colocar em stand-by (encerra terminais)', onClick: () => standBy(w.id) }
        : { label: 'Abrir', onClick: () => open(w.id) },
      { label: 'Renomear', onClick: () => setRenaming(w.id) },
      'sep',
      {
        label: w.cwd ? `Diretório padrão: ${w.cwd}` : 'Definir diretório padrão…',
        onClick: async () => {
          const dir = await window.api.dialog.openDir(w.cwd)
          if (dir) update(w.id, { cwd: dir })
        }
      },
      ...(w.cwd ? [{ label: 'Remover diretório padrão', onClick: () => update(w.id, { cwd: '' }) }] : []),
      'sep',
      { label: 'Excluir…', danger: true, onClick: () => setDeleting(w) }
    ])

  if (!settings) return null

  const daysLeft = (w: Workspace) => Math.max(0, Math.ceil(settings.trashDays - (Date.now() - Date.parse(w.deletedAt!)) / DAY))

  return (
    <SettingsContext.Provider value={settings}>
      <div className="fw-app">
        <aside className="fw-sidebar">
          <WorkspaceList
            workspaces={live}
            opened={opened}
            active={active}
            renaming={renaming}
            onOpen={open}
            onRename={(id, name) => update(id, { name })}
            onRenamed={() => setRenaming(null)}
            onStartRename={setRenaming}
            onCreate={create}
            onWorkspaceMenu={workspaceMenu}
            openMenu={openMenu}
          />
          <div className="fw-sidebar-foot">
            {trash.length > 0 && (
              <>
                <button className="fw-ws fw-trash-head" onClick={() => setShowTrash(!showTrash)}>
                  {showTrash ? '▾' : '▸'} 🗑 Lixeira ({trash.length})
                </button>
                {showTrash &&
                  trash.map((w) => (
                    <div key={w.id} className="fw-trash-item" title={`Apagado de vez em ${daysLeft(w)} dia(s)`}>
                      <span>
                        {w.name} · {daysLeft(w)}d
                      </span>
                      <button title="Restaurar" onClick={() => update(w.id, { deletedAt: null })}>
                        ↺
                      </button>
                      <button title="Excluir agora" onClick={() => setDeleting(w)}>
                        ×
                      </button>
                    </div>
                  ))}
              </>
            )}
            <button className="fw-ws" onClick={() => setEditingSettings(true)}>
              ⚙ Configurações
            </button>
          </div>
        </aside>
        <main className="fw-main">
          {opened.map((id) => {
            const ws = workspaces.find((w) => w.id === id)
            return (
              ws && (
                <div key={id} className={`fw-canvas-slot${id === active ? '' : ' fw-hidden'}`}>
                  <ReactFlowProvider>
                    <Canvas workspace={ws} active={id === active} />
                  </ReactFlowProvider>
                </div>
              )
            )
          })}
          {!active && (
            <div className="fw-empty">
              <div>Nenhum workspace aberto</div>
              <div className="fw-muted">Os workspaces ficam em stand-by até você abrir um na lista.</div>
            </div>
          )}
        </main>
        {menu}
        {deleting && (
          <DeleteWorkspaceDialog
            workspace={deleting}
            trashDays={settings.trashDays}
            onTrash={deleting.deletedAt ? undefined : () => (moveToTrash(deleting.id), setDeleting(null))}
            onDelete={() => (deleteNow(deleting.id), setDeleting(null))}
            onCancel={() => setDeleting(null)}
          />
        )}
        {editingSettings && (
          <SettingsDialog
            settings={settings}
            onCancel={() => setEditingSettings(false)}
            onSave={async (s) => {
              setSettings(await window.api.settings.set(s))
              setEditingSettings(false)
            }}
          />
        )}
      </div>
    </SettingsContext.Provider>
  )
}
