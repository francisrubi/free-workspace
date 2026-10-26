import { useReactFlow, type NodeProps } from '@xyflow/react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { MenuItem } from '../ContextMenu'
import { useCanvas } from '../context'
import type { FwNode } from '../types'
import { NodeFrame } from './NodeFrame'

type Props = NodeProps<Extract<FwNode, { type: 'explorer' }>>
type Entry = { name: string; path: string; dir: boolean }

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** A folder tree on the canvas: click a file to open it next to the explorer. */
export function ExplorerNode({ id, data, selected }: Props) {
  const { openPath, newTerminal, openMenu, openLazygit } = useCanvas()
  const { updateNodeData } = useReactFlow()
  // Directory listings loaded so far; folders load lazily when expanded.
  const [children, setChildren] = useState<Record<string, Entry[] | string>>({})
  const [filter, setFilter] = useState('')
  const open = new Set(data.open ?? [])

  const load = useCallback(async (dir: string) => {
    try {
      const list = await window.api.file.list(dir)
      setChildren((c) => ({ ...c, [dir]: list }))
    } catch (e) {
      setChildren((c) => ({ ...c, [dir]: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }))
    }
  }, [])

  const refresh = useCallback(() => {
    setChildren({})
    load(data.root)
    for (const dir of data.open ?? []) load(dir)
    // Only on mount / root change: expanding a folder loads it on its own.
  }, [data.root, load])
  useEffect(refresh, [refresh])

  const toggle = (dir: string) => {
    const next = new Set(open)
    if (next.has(dir)) next.delete(dir)
    else {
      next.add(dir)
      if (!children[dir]) load(dir)
    }
    updateNodeData(id, { open: [...next] })
  }

  const entryMenu = (e: React.MouseEvent, entry: Entry) => {
    e.stopPropagation() // not the node's own menu
    const common: MenuItem[] = [
      { label: 'Mostrar na pasta', onClick: () => window.api.shell.showInFolder(entry.path) },
      { label: 'Copiar caminho', onClick: () => window.api.clipboard.writeText(entry.path) }
    ]
    openMenu(
      e,
      entry.dir
        ? [
            { label: '›_  Terminal aqui', onClick: () => newTerminal('shell', entry.path) },
            { label: '✦  Sessão IA aqui', onClick: () => newTerminal('ai', entry.path) },
            { label: '⎇  Git (lazygit) aqui', onClick: () => openLazygit(entry.path, id) },
            'sep',
            ...common
          ]
        : [
            { label: 'Abrir no canvas', onClick: () => openPath(entry.path, id) },
            { label: 'Abrir no VS Code', onClick: () => window.api.shell.openInEditor(entry.path) },
            'sep',
            ...common
          ]
    )
  }

  const row = (entry: Entry, depth: number, label = entry.name) => (
    <div
      key={entry.path}
      className={`fw-tree-row${entry.dir ? ' dir' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      title={entry.path}
      onClick={() => (entry.dir ? toggle(entry.path) : openPath(entry.path, id))}
      onContextMenu={(e) => entryMenu(e, entry)}
    >
      <span className="fw-tree-caret">{entry.dir ? (open.has(entry.path) ? '▾' : '▸') : ''}</span>
      {label}
    </div>
  )

  const tree = (dir: string, depth: number): ReactNode[] => {
    const list = children[dir]
    if (list === undefined) return [<div key={dir + ':loading'} className="fw-tree-note" style={{ paddingLeft: 22 + depth * 14 }}>carregando…</div>]
    if (typeof list === 'string') return [<div key={dir + ':error'} className="fw-tree-note fw-error" style={{ paddingLeft: 22 + depth * 14 }}>{list}</div>]
    return list.flatMap((entry) => [row(entry, depth), ...(entry.dir && open.has(entry.path) ? tree(entry.path, depth + 1) : [])])
  }

  // Filtering searches the folders loaded so far (the root plus any expanded ones).
  const q = filter.trim().toLowerCase()
  const matches = q
    ? Object.values(children)
        .flatMap((l) => (typeof l === 'string' ? [] : l))
        .filter((e) => e.name.toLowerCase().includes(q))
        .sort((a, b) => a.path.localeCompare(b.path))
    : []

  return (
    <NodeFrame
      id={id}
      selected={selected}
      icon="🗂"
      title={data.title || baseName(data.root)}
      subtitle={data.root}
      actions={
        <button title="Recarregar" onClick={refresh}>
          ↻
        </button>
      }
      minWidth={220}
      minHeight={160}
    >
      <div className="fw-explorer">
        <input className="fw-explorer-filter" placeholder="filtrar nas pastas abertas…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="fw-tree">
          {q
            ? matches.length
              ? matches.map((e) => row(e, 0, e.path.slice(data.root.length).replace(/^[\\/]/, '')))
              : <div className="fw-tree-note">nada encontrado nas pastas abertas</div>
            : tree(data.root, 0)}
        </div>
      </div>
    </NodeFrame>
  )
}
