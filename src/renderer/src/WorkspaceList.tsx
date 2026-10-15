import { useEffect, useRef, useState } from 'react'
import { GROUP_PALETTE } from '../../shared/colors'
import { EMPTY_LAYOUT, type SidebarLayout } from '../../shared/settings'
import type { MenuItem } from './ContextMenu'
import { uid, type Workspace } from './types'

type MenuEvent = { clientX: number; clientY: number; preventDefault(): void }

type Props = {
  workspaces: Workspace[]
  opened: string[]
  active: string | null
  renaming: string | null
  onOpen: (id: string) => void
  onRename: (id: string, name: string) => void
  onRenamed: () => void
  onStartRename: (id: string) => void
  onCreate: () => void
  onWorkspaceMenu: (e: React.MouseEvent, w: Workspace) => void
  openMenu: (e: MenuEvent, items: MenuItem[]) => void
}

type Drag = { type: 'ws' | 'group'; id: string }
/** Where a drop would land, for the insertion marker. */
type Hint = { ws: string; after: boolean } | { group: string; into: boolean } | { zone: 'ungrouped' | 'groups-end' }

/**
 * The workspace list: loose workspaces first, then colored groups that collapse. Workspaces
 * drag between/into groups; groups drag to reorder. Arrangement lives in sidebar.json.
 */
export function WorkspaceList(p: Props) {
  const [layout, setLayout] = useState<SidebarLayout | null>(null)
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null)
  const [hint, setHint] = useState<Hint | null>(null)
  const drag = useRef<Drag | null>(null)

  useEffect(() => {
    window.api.sidebar.get().then((l) => setLayout({ ...EMPTY_LAYOUT, ...l }))
  }, [])
  useEffect(() => {
    if (layout) window.api.sidebar.set(layout)
  }, [layout])

  if (!layout) return null

  const live = new Map(p.workspaces.map((w) => [w.id, w]))
  const placed = new Set([...layout.ungrouped, ...Object.values(layout.members).flat()])
  // Workspaces not placed yet (new, or restored from the trash) go to the end of the loose list.
  const loose = [...layout.ungrouped.filter((id) => live.has(id)), ...p.workspaces.filter((w) => !placed.has(w.id)).map((w) => w.id)]
  const membersOf = (g: string) => (layout.members[g] ?? []).filter((id) => live.has(id))

  const update = (fn: (l: SidebarLayout) => SidebarLayout) => setLayout((l) => (l ? fn(l) : l))

  /** Moves a workspace into `group` (null = loose), before `before` or at the end. */
  const moveWorkspace = (id: string, group: string | null, before?: string) =>
    update((l) => {
      const strip = (ids: string[]) => ids.filter((x) => x !== id)
      const members = Object.fromEntries(Object.entries(l.members).map(([g, ids]) => [g, strip(ids)]))
      const ungrouped = strip(loose) // materialize the unplaced ones too, so "before" can find them
      const list = group ? [...(members[group] ?? [])] : ungrouped
      const at = before ? list.indexOf(before) : -1
      list.splice(at < 0 ? list.length : at, 0, id)
      return group ? { ...l, ungrouped, members: { ...members, [group]: list } } : { ...l, ungrouped: list, members }
    })

  const moveGroup = (id: string, before?: string) =>
    update((l) => {
      const g = l.groups.find((x) => x.id === id)!
      const rest = l.groups.filter((x) => x.id !== id)
      const at = before ? rest.findIndex((x) => x.id === before) : -1
      rest.splice(at < 0 ? rest.length : at, 0, g)
      return { ...l, groups: rest }
    })

  const setGroup = (id: string, patch: Partial<SidebarLayout['groups'][number]>) =>
    update((l) => ({ ...l, groups: l.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }))

  const addGroup = () => {
    const id = uid()
    update((l) => ({ ...l, groups: [...l.groups, { id, name: 'Novo grupo', color: GROUP_PALETTE[l.groups.length % GROUP_PALETTE.length] }] }))
    setRenamingGroup(id)
  }

  /** Its workspaces go back to the loose list; nothing is deleted. */
  const removeGroup = (id: string) =>
    update((l) => {
      const { [id]: freed = [], ...members } = l.members
      return { ...l, groups: l.groups.filter((g) => g.id !== id), members, ungrouped: [...loose, ...freed.filter((x) => !loose.includes(x))] }
    })

  const groupMenu = (e: React.MouseEvent, g: SidebarLayout['groups'][number]) =>
    p.openMenu(e, [
      { label: 'Renomear', onClick: () => setRenamingGroup(g.id) },
      { label: g.collapsed ? 'Expandir' : 'Recolher', onClick: () => setGroup(g.id, { collapsed: !g.collapsed }) },
      'sep',
      { label: 'Excluir grupo (os workspaces ficam)', danger: true, onClick: () => removeGroup(g.id) }
    ])

  const endDrag = () => {
    drag.current = null
    setHint(null)
  }
  const dropHandlers = (onOver: (e: React.DragEvent) => Hint | null, onDrop: (d: Drag, h: Hint) => void) => ({
    onDragOver: (e: React.DragEvent) => {
      const h = drag.current && onOver(e)
      if (!h) return
      e.preventDefault()
      e.stopPropagation()
      setHint(h)
    },
    onDrop: (e: React.DragEvent) => {
      const d = drag.current
      const h = d && onOver(e)
      if (!d || !h) return
      e.preventDefault()
      e.stopPropagation()
      onDrop(d, h)
      endDrag()
    }
  })
  const startDrag = (d: Drag) => (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', d.id)
    e.dataTransfer.effectAllowed = 'move'
    drag.current = d
  }

  const isHint = (h: Hint) => hint && JSON.stringify(hint) === JSON.stringify(h)

  const workspaceRow = (id: string, group: string | null, color?: string) => {
    const w = live.get(id)!
    if (p.renaming === id)
      return (
        <input
          key={id}
          className="fw-ws-input"
          autoFocus
          defaultValue={w.name}
          onFocus={(e) => e.target.select()}
          onBlur={(e) => {
            p.onRename(id, e.target.value.trim() || w.name)
            p.onRenamed()
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      )
    const isOpen = p.opened.includes(id)
    return (
      <button
        key={id}
        data-ws={id}
        className={`fw-ws${id === p.active ? ' active' : ''}${group ? ' in-group' : ''}${isHint({ ws: id, after: false }) ? ' drop-before' : ''}${isHint({ ws: id, after: true }) ? ' drop-after' : ''}`}
        style={color ? ({ '--group-color': color } as React.CSSProperties) : undefined}
        draggable
        onDragStart={startDrag({ type: 'ws', id })}
        onDragEnd={endDrag}
        {...dropHandlers(
          (e) => {
            if (drag.current?.type !== 'ws' || drag.current.id === id) return null
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            return { ws: id, after: e.clientY > r.top + r.height / 2 }
          },
          (d, h) => {
            const list = group ? membersOf(group) : loose
            const after = 'after' in h && h.after
            moveWorkspace(d.id, group, after ? list[list.indexOf(id) + 1] : id)
          }
        )}
        onClick={() => p.onOpen(id)}
        onDoubleClick={() => p.onStartRename(id)}
        onContextMenu={(e) => p.onWorkspaceMenu(e, w)}
        title={isOpen ? 'Aberto' : 'Em stand-by: clique para abrir'}
      >
        <span className={`fw-ws-dot${isOpen ? ' on' : ''}`} />
        {w.name}
      </button>
    )
  }

  return (
    <>
      <div
        className={`fw-sidebar-head${isHint({ zone: 'ungrouped' }) ? ' drop-into' : ''}`}
        {...dropHandlers(
          () => (drag.current?.type === 'ws' ? { zone: 'ungrouped' } : null),
          (d) => moveWorkspace(d.id, null)
        )}
      >
        Workspaces
      </div>
      {loose.map((id) => workspaceRow(id, null))}

      {layout.groups.map((g) => {
        const ids = membersOf(g.id)
        const anyOpen = ids.some((id) => p.opened.includes(id))
        return (
          <div key={g.id} className="fw-group" data-group={g.id}>
            <div
              className={`fw-group-head${isHint({ group: g.id, into: true }) ? ' drop-into' : ''}${isHint({ group: g.id, into: false }) ? ' drop-before' : ''}`}
              style={{ '--group-color': g.color } as React.CSSProperties}
              draggable={renamingGroup !== g.id}
              onDragStart={startDrag({ type: 'group', id: g.id })}
              onDragEnd={endDrag}
              {...dropHandlers(
                () => (drag.current?.type === 'ws' ? { group: g.id, into: true } : drag.current?.id !== g.id ? { group: g.id, into: false } : null),
                (d, h) => ('into' in h && h.into ? moveWorkspace(d.id, g.id) : moveGroup(d.id, g.id))
              )}
              onClick={() => setGroup(g.id, { collapsed: !g.collapsed })}
              onContextMenu={(e) => groupMenu(e, g)}
            >
              <span className="fw-group-caret">{g.collapsed ? '▸' : '▾'}</span>
              <input
                type="color"
                value={g.color}
                title="Cor do grupo"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setGroup(g.id, { color: e.target.value })}
              />
              {renamingGroup === g.id ? (
                <input
                  className="fw-ws-input"
                  autoFocus
                  defaultValue={g.name}
                  onClick={(e) => e.stopPropagation()}
                  onFocus={(e) => e.target.select()}
                  onBlur={(e) => {
                    setGroup(g.id, { name: e.target.value.trim() || g.name })
                    setRenamingGroup(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              ) : (
                <span className="fw-group-name" onDoubleClick={(e) => (e.stopPropagation(), setRenamingGroup(g.id))}>
                  {g.name}
                </span>
              )}
              {anyOpen && g.collapsed && <span className="fw-ws-dot on" title="Há workspaces abertos neste grupo" />}
              <span className="fw-group-count">{ids.length}</span>
            </div>
            {!g.collapsed && ids.map((id) => workspaceRow(id, g.id, g.color))}
          </div>
        )
      })}
      {layout.groups.length > 0 && (
        <div
          className={`fw-groups-end${isHint({ zone: 'groups-end' }) ? ' drop-before' : ''}`}
          {...dropHandlers(
            () => (drag.current?.type === 'group' ? { zone: 'groups-end' } : null),
            (d) => moveGroup(d.id)
          )}
        />
      )}
      <div className="fw-sidebar-actions">
        <button className="fw-ws fw-ws-add" onClick={p.onCreate}>
          + workspace
        </button>
        <button className="fw-ws fw-ws-add" onClick={addGroup}>
          + grupo
        </button>
      </div>
    </>
  )
}
