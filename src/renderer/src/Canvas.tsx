import {
  addEdge,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type Viewport
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useContextMenu, type MenuItem } from './ContextMenu'
import { nodeColor } from '../../shared/colors'
import { CanvasContext, StackContext, useSettings, useWorkspaces, type Tab } from './context'
import { nodeIcon, nodeTitle } from './nodeInfo'
import { ExplorerNode } from './nodes/ExplorerNode'
import { FileNode } from './nodes/FileNode'
import { ImageNode } from './nodes/ImageNode'
import { NoteNode } from './nodes/NoteNode'
import { TerminalNode } from './nodes/TerminalNode'
import { TodoNode } from './nodes/TodoNode'
import { MoveDialog } from './MoveDialog'
import { RoleDialog } from './RoleDialog'
import { TerminalDialog } from './TerminalDialog'
import { copySelection, gitInfo, pasteInto, terminals } from './terminals'
import { isClaude, uid, type FwNode, type TerminalData, type Workspace } from './types'

const nodeTypes = { terminal: TerminalNode, note: NoteNode, file: FileNode, image: ImageNode, todo: TodoNode, explorer: ExplorerNode }
const DRAG_HANDLE = '.fw-drag'
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i

/** `edges` connect Claude sessions that may talk to each other; a connection works both ways. */
type Saved = { nodes: FwNode[]; edges?: Edge[]; viewport: Viewport }
const pairKey = (a: string, b: string) => [a, b].sort().join('|')
type Point = { x: number; y: number }
type NewNode = Omit<FwNode, 'id' | 'position'> & { position?: Point; id?: string }

/**
 * One workspace's canvas. Opened workspaces stay mounted (hidden when not `active`) so
 * terminals and TUIs keep their live screen; anything global — paste, Delete — must check
 * `active` or it would hit every open workspace at once.
 */
export function Canvas({ workspace, active }: { workspace: Workspace; active: boolean }) {
  const workspaceId = workspace.id
  const settings = useSettings()
  const [nodes, setNodes, onNodesChange] = useNodesState<FwNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [waiting, setWaiting] = useState<Set<string>>(new Set())
  const [roleFor, setRoleFor] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const { workspaces, opened } = useWorkspaces()
  const [notice, setNotice] = useState<{ title: string; text: string; command?: string } | null>(null)
  // Node whose color the hidden <input type=color> below is editing.
  const [colorFor, setColorFor] = useState<string | null>(null)
  const colorInput = useRef<HTMLInputElement>(null)
  const [loaded, setLoaded] = useState<Saved | null>(null)
  const [loadError, setLoadError] = useState('')
  const [dialog, setDialog] = useState<{ kind: TerminalData['kind']; at?: Point; cwd?: string } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [menu, openMenu] = useContextMenu()
  const wrapper = useRef<HTMLDivElement>(null)
  // With right-drag panning, the browser still fires `contextmenu` on release: only open the
  // menu when the pointer barely moved since the right button went down.
  const rightDown = useRef<Point | null>(null)
  const wasDrag = (e: { clientX: number; clientY: number }) =>
    !!rightDown.current && Math.hypot(e.clientX - rightDown.current.x, e.clientY - rightDown.current.y) > 4
  const { screenToFlowPosition, getViewport, deleteElements, getNodes, fitView, getZoom } = useReactFlow()

  useEffect(() => {
    window.api.ws
      .load(workspaceId)
      .then((data: Saved) => {
        setNodes(data.nodes.map((n) => ({ ...n, dragHandle: DRAG_HANDLE })))
        setEdges(data.edges ?? [])
        setLoaded(data)
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [workspaceId, setNodes, setEdges])

  // Debounced autosave of the whole canvas (positions, sizes, node data, connections, viewport).
  const save = useCallback(() => {
    const clean = nodes.map(({ id, type, position, width, height, data }) => ({ id, type, position, width, height, data }))
    const links = edges.map(({ id, source, target, sourceHandle, targetHandle }) => ({ id, source, target, sourceHandle, targetHandle }))
    window.api.ws.save(workspaceId, { nodes: clean, edges: links, viewport: getViewport() })
  }, [nodes, edges, workspaceId, getViewport])

  // The main process answers the sessions' MCP calls, so it needs to know who exists here and
  // who is connected to whom. Nodes change on every drag frame; only send real changes.
  const lastSync = useRef('')
  useEffect(() => {
    if (!loaded) return
    const sessions = nodes.flatMap((n) => (n.type === 'terminal' && isClaude(n.data) ? [n] : []))
    const ids = new Set(sessions.map((n) => n.id))
    const list = sessions.map((n) => ({
      id: n.id,
      title: n.data.title,
      role: n.data.role,
      cwd: n.data.cwd,
      peers: edges
        .filter((e) => e.source === n.id || e.target === n.id)
        .map((e) => (e.source === n.id ? e.target : e.source))
        .filter((id) => ids.has(id))
    }))
    const key = JSON.stringify(list)
    if (key === lastSync.current) return
    lastSync.current = key
    window.api.agents.sync(workspaceId, list)
  }, [nodes, edges, loaded, workspaceId])
  useEffect(() => () => window.api.agents.sync(workspaceId, []), [workspaceId])

  // Animate a connection while one session waits for the other's answer.
  useEffect(
    () =>
      window.api.agents.onActivity(({ from, to, pending }) =>
        setWaiting((w) => {
          const next = new Set(w)
          if (pending) next.add(pairKey(from, to))
          else next.delete(pairKey(from, to))
          return next
        })
      ),
    []
  )

  const canTalk = (id: string) => nodes.some((n) => n.id === id && n.type === 'terminal' && isClaude(n.data))
  const isValidConnection = (c: Connection | Edge) =>
    c.source !== c.target &&
    canTalk(c.source) &&
    canTalk(c.target) &&
    !edges.some((e) => pairKey(e.source, e.target) === pairKey(c.source, c.target))
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(save, 400)
    return () => clearTimeout(t)
  }, [save, loaded])
  // Closing the window inside the debounce would lose the last change: save right away.
  const saveNow = useRef(save)
  saveNow.current = save
  useEffect(() => {
    if (!loaded) return
    const flush = () => saveNow.current()
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [loaded])

  const center = (): Point => {
    const r = wrapper.current!.getBoundingClientRect()
    return screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  }
  /** Adds a node centred on `position` (or on the visible canvas). */
  const add = (node: NewNode): string => {
    const c = node.position ?? center()
    const w = node.width ?? 400
    const h = node.height ?? 300
    const position = { x: c.x - w / 2, y: c.y - h / 2 }
    const id = node.id ?? uid()
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...node, id, position, selected: true, dragHandle: DRAG_HANDLE } as FwNode])
    return id
  }

  const addImage = async (file: File, at?: Point) => {
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg')
    addImageSrc(await window.api.ws.saveImage(workspaceId, new Uint8Array(await file.arrayBuffer()), ext), at)
  }
  const addImageSrc = async (src: string, at?: Point) => {
    const { width, height } = await imageSize(src)
    const scale = Math.min(1, 520 / width)
    add({ type: 'image', data: { src }, width: Math.round(width * scale), height: Math.round(height * scale) + 32, position: at })
  }

  // Ctrl+V with an image anywhere in the app drops it on the active canvas.
  useEffect(() => {
    if (!active) return
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (!file) return
      e.preventDefault()
      e.stopPropagation()
      addImage(file)
    }
    window.addEventListener('paste', onPaste, true)
    return () => window.removeEventListener('paste', onPaste, true)
  })

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    let at = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    for (const file of e.dataTransfer.files) {
      if (IMAGE_EXT.test(file.name)) addImage(file, at)
      else add({ type: 'file', data: { path: window.api.file.pathOf(file) }, width: 560, height: 420, position: at })
      at = { x: at.x + 40, y: at.y + 40 }
    }
  }

  const openFiles = async (at?: Point) => {
    for (const p of await window.api.dialog.openFile()) {
      add({ type: 'file', data: { path: p }, width: 560, height: 420, position: at })
      if (at) at = { x: at.x + 40, y: at.y + 40 }
    }
  }

  const defaultDir = workspace.cwd || settings.terminalCwd

  const openExplorer = async (at?: Point) => {
    const root = await window.api.dialog.openDir(defaultDir)
    if (root) add({ type: 'explorer', data: { root }, width: 320, height: 520, position: at })
  }

  /** Shows a file on the canvas: focuses it if it's already there, else opens it beside `from`. */
  const openPath = async (path: string, from?: string) => {
    const all = getNodes()
    const existing = all.find((n) => n.type === 'file' && n.data.path === path)
    if (existing) {
      setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === existing.id })))
      fitView({ nodes: [{ id: existing.id }], duration: 200, maxZoom: getZoom() })
      return
    }
    const src = all.find((n) => n.id === from)
    const w = 560
    const h = 420
    const at = src
      ? { x: src.position.x + (src.width ?? src.measured?.width ?? 320) + 40 + w / 2, y: src.position.y + h / 2 }
      : undefined
    if (IMAGE_EXT.test(path)) addImageSrc(await window.api.ws.importImage(workspaceId, path), at)
    else add({ type: 'file', data: { path }, width: w, height: h, position: at })
  }

  // Sessions put things here through the MCP canvas tools. Each new item goes to the right of
  // the session that asked, cascading down so consecutive ones don't stack on top of each other.
  const cascade = useRef(new Map<string, number>())
  /** Center for a w×h node to the right of node `from`, cascading so repeats don't stack. */
  const beside = (from: string | undefined, w: number, h: number): Point | undefined => {
    const src = from ? getNodes().find((n) => n.id === from) : undefined
    if (!src) return undefined
    const n = cascade.current.get(src.id) ?? 0
    cascade.current.set(src.id, n + 1)
    return { x: src.position.x + (src.width ?? src.measured?.width ?? 400) + 40 + w / 2 + (n % 5) * 30, y: src.position.y + h / 2 + (n % 5) * 40 }
  }

  const openExplorerAt = (root: string, from?: string) =>
    add({ type: 'explorer', data: { root }, width: 320, height: 520, position: beside(from, 320, 520) })

  const openLazygit = async (cwd: string, from?: string) => {
    if (!(await window.api.hasCommand('lazygit'))) {
      setNotice({
        title: 'lazygit não encontrado',
        text: 'O lazygit é uma interface de git que roda no terminal. Instale e abra de novo (pode ser preciso reiniciar o app para ele aparecer no PATH):',
        command: 'winget install -e --id JesseDuffield.lazygit'
      })
      return
    }
    add({ type: 'terminal', data: { kind: 'shell', title: 'lazygit', cwd, command: 'lazygit' }, width: 900, height: 560, position: beside(from, 900, 560) })
  }

  useEffect(
    () =>
      window.api.onCanvasOpen(workspaceId, ({ from, item }) => {
        if (item.type === 'file') return void openPath(item.path, from)
        if (item.type === 'session') {
          const at = beside(from, 640, 380)
          const id = add({
            id: item.id,
            type: 'terminal',
            data: { kind: 'ai', provider: 'claude', title: item.title, role: item.role, cwd: item.cwd, command: item.command },
            width: 640,
            height: 380,
            position: at
          })
          // Born connected to the session that asked for it, so they can talk right away.
          setEdges((es) => addEdge({ source: from, target: id, sourceHandle: 'r', targetHandle: 'l' }, es))
          return
        }
        const w = item.type === 'terminal' ? 640 : item.type === 'note' ? 380 : 300
        const h = item.type === 'terminal' ? 380 : 300
        const at = beside(from, w, h)
        if (item.type === 'note') add({ type: 'note', data: { text: item.text, title: item.title }, width: w, height: h, position: at })
        else if (item.type === 'todo')
          add({ type: 'todo', data: { title: item.title, items: item.items.map((text) => ({ id: uid(), text, done: false })) }, width: w, height: h, position: at })
        else add({ type: 'terminal', data: { kind: 'shell', title: item.title, cwd: item.cwd, command: item.command }, width: w, height: h, position: at })
      }),
    // openPath/add only use stable setters and getNodes().
    [workspaceId]
  )

  const creators = (at?: Point): MenuItem[] => [
    { label: '›_  Terminal', onClick: () => setDialog({ kind: 'shell', at }) },
    { label: '✦  Sessão IA', onClick: () => setDialog({ kind: 'ai', at }) },
    { label: '✎  Nota', onClick: () => add({ type: 'note', data: { text: '' }, width: 360, height: 260, position: at }) },
    { label: '☑  ToDo', onClick: () => add({ type: 'todo', data: { title: 'ToDo', items: [] }, width: 280, height: 260, position: at }) },
    { label: '📄  Arquivo…', onClick: () => openFiles(at) },
    { label: '🗂  Explorador de pasta…', onClick: () => openExplorer(at) }
  ]

  const duplicate = (node: FwNode) => {
    const data = structuredClone(node.data) as Record<string, unknown>
    if (node.type === 'terminal') {
      // A fresh process and a fresh conversation, not a second view of the same ones.
      data.started = false
      delete data.sessionId
    }
    if (typeof data.title === 'string') data.title += ' (cópia)'
    delete data.stack
    delete data.stackActive
    const w = node.width ?? node.measured?.width ?? 400
    const h = node.height ?? node.measured?.height ?? 300
    add({ type: node.type, data, width: w, height: h, position: { x: node.position.x + w / 2 + 30, y: node.position.y + h / 2 + 30 } } as NewNode)
  }

  const setNodeColor = (id: string, color: string | undefined) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, color } } as FwNode) : n)))
  const pickColor = (node: FwNode) => {
    const input = colorInput.current!
    input.value = nodeColor(node.type, node.data, settings.nodeColors) ?? '#7aa2f7'
    setColorFor(node.id)
    // The e2e test sets the value itself: a native picker it can't see would hold the keyboard.
    if (window.api.isTest) return
    try {
      input.showPicker() // works from the menu click (a user gesture)
    } catch {
      // No gesture (scripted click): nothing to show the picker for.
    }
  }

  /**
   * A terminal where `claude` was started by hand (or by an old open_terminal) is a plain
   * terminal to the app: no hooks, no MCP, no dots to connect. Turn it into a session and
   * restart it: `claude --continue` brings back the folder's latest conversation, now with
   * hooks and MCP, and from then on the exact one is tracked.
   */
  const convertToSession = (node: FwNode) => {
    if (node.type !== 'terminal') return
    // Keep flags like --effort/--model from the old command, drop a quoted prompt.
    const flags = (node.data.command ?? '').match(/--(effort|model)\s+\S+/g)?.join(' ') ?? ''
    const base = [window.api.claudeBin, flags].filter(Boolean).join(' ')
    setNodes((ns) =>
      ns.map((n) =>
        n.id === node.id && n.type === 'terminal'
          ? { ...n, data: { ...n.data, kind: 'ai', provider: 'claude', command: base, resumeCommand: `${base} --continue`, started: true, sessionId: undefined } }
          : n
      )
    )
    // Restart after the new data reached the node.
    setTimeout(() => terminals.get(node.id)?.restart(), 50)
  }

  /**
   * Moves a node to another workspace without restarting anything: its terminal process lives
   * in the main process under the node id, so the same id in the other canvas re-attaches to it.
   * Connections don't cross workspaces, so the node's edges are dropped.
   */
  /** A node in a tab group moves with its whole group, tabs kept; any other node moves alone. */
  const moveNode = async (node: FwNode, to: string) => {
    const group = node.data.stack ? groups.get(node.data.stack) : undefined
    const members = group ?? [node]
    const ids = new Set(members.map((n) => n.id))
    const moved = await Promise.all(
      members.map(async (n) => {
        let data = n.data
        if (n.type === 'image') data = { ...n.data, src: await window.api.ws.copyAsset(n.data.src, to) }
        if (n.type === 'terminal') window.api.pty.setWorkspace(n.id, to)
        if (!group) data = { ...data, stack: undefined, stackActive: undefined }
        return { id: n.id, type: n.type, position: n.position, width: n.width, height: n.height, data } as FwNode
      })
    )
    setNodes((ns) => ns.filter((n) => !ids.has(n.id))) // not deleteElements: that would kill the terminals
    setEdges((es) => es.filter((e) => !ids.has(e.source) && !ids.has(e.target)))
    // A loaded workspace takes them into its live canvas (its autosave would drop them otherwise);
    // one on stand-by gets them written into its canvas.json (one at a time: each write rereads the file).
    if (opened.includes(to)) window.dispatchEvent(new CustomEvent('fw:receive-node', { detail: { workspaceId: to, nodes: moved } }))
    else for (const n of moved) await window.api.ws.appendNode(to, n)
  }

  useEffect(() => {
    const receive = (e: Event) => {
      const { workspaceId: target, nodes: incoming } = (e as CustomEvent<{ workspaceId: string; nodes: FwNode[] }>).detail
      if (target !== workspaceId) return
      // Lands in the middle of the view (its old position means nothing here); a tab group's
      // members all share that spot.
      const w = incoming[0].width ?? 400
      const h = incoming[0].height ?? 300
      const c = center()
      const position = { x: c.x - w / 2, y: c.y - h / 2 }
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...incoming.map((n) => ({ ...n, position, selected: true, dragHandle: DRAG_HANDLE }))])
    }
    window.addEventListener('fw:receive-node', receive)
    return () => window.removeEventListener('fw:receive-node', receive)
  }, [workspaceId])

  const nodeMenu = (node: FwNode): MenuItem[] => {
    const specific: MenuItem[] = []
    if (node.type === 'terminal') {
      const t = terminals.get(node.id)
      specific.push(
        { label: 'Copiar seleção', disabled: !t?.term.hasSelection(), onClick: () => t && copySelection(t.term) },
        { label: 'Colar', disabled: !t, onClick: () => t && pasteInto(t.term) },
        { label: 'Limpar tela', disabled: !t, onClick: () => t?.term.clear() },
        { label: node.data.kind === 'ai' ? 'Reiniciar (retomar sessão)' : 'Reiniciar processo', disabled: !t, onClick: () => t?.restart() }
      )
      if (isClaude(node.data)) specific.push({ label: 'Papel da sessão…', onClick: () => setRoleFor(node.id) })
      else specific.push({ label: '✦  Converter em sessão Claude (retoma a última conversa da pasta)', onClick: () => convertToSession(node) })
      // Explorer / lazygit from the terminal's folder, its repository root and its other worktrees.
      const g = gitInfo.get(node.id)
      const here = node.data.cwd
      const same = (a: string, b: string) => a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      specific.push('sep')
      if (here) specific.push({ label: '🗂  Explorador nesta pasta', onClick: () => openExplorerAt(here, node.id) })
      if (g && (!here || !same(g.root, here))) specific.push({ label: '🗂  Explorador na raiz do repositório', onClick: () => openExplorerAt(g.root, node.id) })
      for (const w of (g?.worktrees ?? []).filter((w) => !same(w.path, g!.root)).slice(0, 6))
        specific.push({ label: `🗂  Explorador em ${w.branch || w.path} (worktree)`, onClick: () => openExplorerAt(w.path, node.id) })
      if (g) specific.push({ label: '⎇  Git (lazygit)', onClick: () => openLazygit(g.root, node.id) })
    }
    if (node.type === 'file') {
      specific.push(
        { label: 'Abrir no VS Code', onClick: () => window.api.shell.openInEditor(node.data.path) },
        { label: 'Mostrar na pasta', onClick: () => window.api.shell.showInFolder(node.data.path) },
        { label: 'Copiar caminho', onClick: () => window.api.clipboard.writeText(node.data.path) }
      )
    }
    if (node.type === 'explorer') {
      specific.push(
        {
          label: 'Trocar pasta…',
          onClick: async () => {
            const root = await window.api.dialog.openDir(node.data.root)
            if (root) setNodes((ns) => ns.map((n) => (n.id === node.id ? ({ ...n, data: { ...n.data, root, open: [] } } as FwNode) : n)))
          }
        },
        { label: '›_  Terminal nesta pasta', onClick: () => setDialog({ kind: 'shell', cwd: node.data.root }) },
        { label: '⎇  Git (lazygit) nesta pasta', onClick: () => openLazygit(node.data.root, node.id) },
        { label: 'Mostrar na pasta', onClick: () => window.api.shell.showInFolder(node.data.root) }
      )
    }
    if (node.type === 'image') {
      specific.push(
        { label: 'Copiar imagem', onClick: () => window.api.clipboard.writeAsset(node.data.src) },
        { label: 'Mostrar na pasta', onClick: async () => window.api.shell.showInFolder(await window.api.assetPath(node.data.src)) }
      )
    }
    return [
      { label: 'Renomear', onClick: () => setRenamingId(node.id) },
      { label: 'Duplicar', onClick: () => duplicate(node) },
      { label: groups.has(node.data.stack ?? '') ? 'Mover o grupo de abas para outro workspace…' : 'Mover para outro workspace…', onClick: () => setMovingId(node.id) },
      ...(groups.has(node.data.stack ?? '')
        ? [{ label: 'Tirar do grupo de abas', onClick: () => setNodes((ns) => leaveGroup(ns, node.id, { x: node.position.x + 40, y: node.position.y + 40 })) }]
        : []),
      { label: 'Cor…', onClick: () => pickColor(node) },
      ...(node.data.color ? [{ label: 'Usar a cor padrão do tipo', onClick: () => setNodeColor(node.id, undefined) }] : []),
      ...(specific.length ? (['sep', ...specific] as MenuItem[]) : []),
      'sep',
      { label: node.type === 'terminal' ? 'Remover (encerra o processo)' : 'Remover', danger: true, onClick: () => deleteElements({ nodes: [{ id: node.id }] }) }
    ]
  }

  // ---------- tab groups ----------
  // Members of a group (2+ nodes sharing `stack`), in canvas order; the active one is the
  // member flagged stackActive, else the first. Groups of one are just a node.
  const groups = useMemo(() => {
    const m = new Map<string, FwNode[]>()
    for (const n of nodes) if (n.data.stack) m.set(n.data.stack, [...(m.get(n.data.stack) ?? []), n])
    for (const [k, v] of m) if (v.length < 2) m.delete(k)
    return m
  }, [nodes])
  const activeOf = (members: FwNode[]) => members.find((n) => n.data.stackActive) ?? members[0]
  const hiddenIds = useMemo(() => {
    const ids = new Set<string>()
    for (const members of groups.values()) {
      const active = activeOf(members)
      for (const n of members) if (n !== active) ids.add(n.id)
    }
    return ids
  }, [groups])
  // Tabs per member. Rebuilt from a signature so dragging a node doesn't re-render every header.
  const tabsSig = JSON.stringify(
    [...groups.values()].map((ms) => ms.map((n) => [n.id, nodeTitle(n), nodeIcon(n), nodeColor(n.type, n.data, settings.nodeColors) ?? '', n === activeOf(ms)]))
  )
  const tabsOf = useMemo(() => {
    const m = new Map<string, Tab[]>()
    for (const group of JSON.parse(tabsSig) as [string, string, string, string, boolean][][]) {
      const tabs = group.map(([id, title, icon, color, active]) => ({ id, title, icon, color: color || undefined, active }))
      for (const t of tabs) m.set(t.id, tabs)
    }
    return m
  }, [tabsSig])

  /** Shows member `id`, in the spot (and size) of the one shown so far. */
  const activate = (id: string) =>
    setNodes((ns) => {
      const stack = ns.find((n) => n.id === id)?.data.stack
      const members = ns.filter((n) => n.data.stack === stack)
      const shown = activeOf(members)
      return ns.map((n) =>
        n.data.stack !== stack || !stack
          ? n
          : ({
              ...n,
              position: shown.position,
              width: shown.width ?? shown.measured?.width,
              height: shown.height ?? shown.measured?.height,
              selected: n.id === id,
              data: { ...n.data, stackActive: n.id === id }
            } as FwNode)
      )
    })

  /** Takes `id` out of its group; the group keeps its spot (a group left with one dissolves). */
  const leaveGroup = (ns: FwNode[], id: string, at?: Point): FwNode[] => {
    const node = ns.find((n) => n.id === id)
    const stack = node?.data.stack
    if (!node || !stack) return ns
    const rest = ns.filter((n) => n.data.stack === stack && n.id !== id)
    const wasShown = activeOf(ns.filter((n) => n.data.stack === stack)) === node
    const next = wasShown ? rest[0] : activeOf(rest)
    return ns.map((n) => {
      if (n.id === id)
        return { ...n, position: at ?? n.position, selected: true, data: { ...n.data, stack: undefined, stackActive: undefined } } as FwNode
      if (n.data.stack !== stack) return { ...n, selected: false }
      if (rest.length === 1) return { ...n, selected: false, data: { ...n.data, stack: undefined, stackActive: undefined } } as FwNode
      return { ...n, position: wasShown ? node.position : n.position, selected: false, data: { ...n.data, stackActive: n.id === next.id } } as FwNode
    })
  }

  const detach = (id: string, clientX: number, clientY: number) => {
    const p = screenToFlowPosition({ x: clientX, y: clientY })
    setNodes((ns) => leaveGroup(ns, id, { x: p.x - 40, y: p.y - 16 }))
  }

  /** Puts `dragId` in `targetId`'s group (making one if needed), shown in the target's spot. */
  const stackInto = (dragId: string, targetId: string) =>
    setNodes((ns0) => {
      const ns = leaveGroup(ns0, dragId)
      const target = ns.find((n) => n.id === targetId)
      if (!target) return ns0
      const stack = target.data.stack ?? uid()
      const shown = target.data.stack ? activeOf(ns.filter((n) => n.data.stack === stack)) : target
      return ns.map((n) => {
        if (n.id === dragId)
          return {
            ...n,
            position: shown.position,
            width: shown.width ?? shown.measured?.width,
            height: shown.height ?? shown.measured?.height,
            selected: true,
            data: { ...n.data, stack, stackActive: true }
          } as FwNode
        if (n.id === targetId || n.data.stack === stack) return { ...n, selected: false, data: { ...n.data, stack, stackActive: false } } as FwNode
        return n
      })
    })

  /**
   * After a drag: a node dropped by its header onto another node's header joins that node's tab
   * group; a group's shown member drags its hidden ones along.
   */
  const onNodeDragStop = (e: MouseEvent | TouchEvent, node: FwNode) => {
    const pt = 'changedTouches' in e ? e.changedTouches[0] : e
    const under = document
      .elementsFromPoint(pt.clientX, pt.clientY)
      .map((el) => el.closest('.react-flow__node'))
      .find((el): el is HTMLElement => !!el && (el as HTMLElement).dataset.id !== node.id && !el.classList.contains('fw-stack-hidden'))
    const onHeader = under && document.elementsFromPoint(pt.clientX, pt.clientY).some((el) => el.closest('.fw-node-header') && under.contains(el))
    if (under && onHeader) return stackInto(node.id, under.dataset.id!)
    if (node.data.stack) setNodes((ns) => ns.map((n) => (n.data.stack === node.data.stack && n.id !== node.id ? { ...n, position: node.position } : n)))
  }

  const stackCtx = useMemo(() => ({ tabsOf, activate, detach }), [tabsOf])

  const ctx = useMemo(
    () => ({
      workspaceId,
      renamingId,
      setRenamingId,
      openPath,
      openMenu,
      openLazygit,
      newTerminal: (kind: TerminalData['kind'], cwd: string) => setDialog({ kind, cwd })
    }),
    // openPath reads nodes through getNodes(), so it doesn't need to change with them.
    [workspaceId, renamingId]
  )

  if (loadError) return <div className="fw-error">Não foi possível abrir este workspace: {loadError}</div>
  if (!loaded) return null

  return (
    <CanvasContext.Provider value={ctx}>
    <StackContext.Provider value={stackCtx}>
      <div
        className="fw-canvas"
        ref={wrapper}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onPointerDownCapture={(e) => {
          if (e.button === 2) rightDown.current = { x: e.clientX, y: e.clientY }
        }}
      >
        <div className="fw-toolbar">
          <button onClick={() => setDialog({ kind: 'shell' })}>›_ Terminal</button>
          <button onClick={() => setDialog({ kind: 'ai' })}>✦ Sessão IA</button>
          <button onClick={() => add({ type: 'note', data: { text: '' }, width: 360, height: 260 })}>✎ Nota</button>
          <button onClick={() => add({ type: 'todo', data: { title: 'ToDo', items: [] }, width: 280, height: 260 })}>☑ ToDo</button>
          <button onClick={() => openFiles()}>📄 Arquivo</button>
          <button onClick={() => openExplorer()}>🗂 Explorador</button>
          <span className="fw-muted fw-hint">Ctrl+V cola print · arraste arquivos · clique direito para opções · ligue os pontos de duas sessões para elas conversarem</span>
          <ZoomIndicator />
        </div>
        <ReactFlow
          // Hidden group members stay mounted (terminals keep drawing) but can't be seen or grabbed.
          nodes={nodes.map((n) => (hiddenIds.has(n.id) ? { ...n, className: 'fw-stack-hidden', selectable: false, draggable: false } : n))}
          onNodeDragStop={onNodeDragStop}
          onNodesChange={onNodesChange}
          edges={edges.map((e) => ({ ...e, animated: waiting.has(pairKey(e.source, e.target)) }))}
          onEdgesChange={onEdgesChange}
          onConnect={(c) => setEdges((es) => addEdge(c, es))}
          isValidConnection={isValidConnection}
          connectionMode={ConnectionMode.Loose}
          nodeTypes={nodeTypes}
          defaultViewport={loaded.viewport}
          onMoveEnd={save}
          onNodesDelete={(deleted) => deleted.forEach((n) => n.type === 'terminal' && window.api.pty.kill(n.id))}
          onNodeContextMenu={(e, node) => openMenu(e, nodeMenu(node))}
          onPaneContextMenu={(e) => {
            e.preventDefault()
            if (!(settings.rightDragPan && wasDrag(e))) openMenu(e, creators(screenToFlowPosition({ x: e.clientX, y: e.clientY })))
          }}
          panOnDrag={settings.rightDragPan ? [0, 2] : true}
          deleteKeyCode={active ? 'Delete' : null}
          // Unique per canvas: React Flow derives SVG ids (background grid, markers) from it, and
          // with the default "1" every open workspace pointed at the first one's grid.
          id={`ws-${workspaceId}`}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
          {settings.showControls && <Controls showZoom={false} />}
          {settings.showMinimap && (
            <MiniMap pannable zoomable nodeColor={(n) => nodeColor(n.type, n.data, settings.nodeColors) ?? '#2c313b'} />
          )}
        </ReactFlow>
        {menu}
        <input
          ref={colorInput}
          id="fw-node-color-picker"
          type="color"
          className="fw-hidden-input"
          tabIndex={-1}
          onChange={(e) => colorFor && setNodeColor(colorFor, e.target.value)}
        />
        {notice && (
          <div className="fw-modal-backdrop" onMouseDown={() => setNotice(null)}>
            <div className="fw-modal fw-notice" onMouseDown={(e) => e.stopPropagation()}>
              <h3>{notice.title}</h3>
              <p className="fw-help fw-modal-text">{notice.text}</p>
              {notice.command && (
                <div className="fw-row">
                  <code className="fw-command">{notice.command}</code>
                  <button type="button" onClick={() => window.api.clipboard.writeText(notice.command!)}>
                    Copiar
                  </button>
                </div>
              )}
              <div className="fw-row fw-end">
                <button type="button" className="primary" onClick={() => setNotice(null)}>
                  Ok
                </button>
              </div>
            </div>
          </div>
        )}
        {movingId && (
          <MoveDialog
            nodeTitle={(() => {
              const n = nodes.find((x) => x.id === movingId)
              if (!n) return 'elemento'
              const group = n.data.stack ? groups.get(n.data.stack) : undefined
              return group ? `${nodeTitle(n)}" e mais ${group.length - 1} aba(s) do grupo "` : nodeTitle(n)
            })()}
            targets={workspaces.filter((w) => w.id !== workspaceId).map((w) => ({ ...w, open: opened.includes(w.id) }))}
            onCancel={() => setMovingId(null)}
            onPick={(to) => {
              const node = nodes.find((n) => n.id === movingId)
              setMovingId(null)
              if (node) moveNode(node, to)
            }}
          />
        )}
        {roleFor && (
          <RoleDialog
            node={nodes.find((n) => n.id === roleFor)}
            onCancel={() => setRoleFor(null)}
            onSave={(role) => {
              setNodes((ns) => ns.map((n) => (n.id === roleFor && n.type === 'terminal' ? { ...n, data: { ...n.data, role: role || undefined } } : n)))
              setRoleFor(null)
            }}
          />
        )}
        {dialog && (
          <TerminalDialog
            kind={dialog.kind}
            defaultCwd={dialog.cwd || defaultDir}
            onCancel={() => setDialog(null)}
            onCreate={(data) => {
              add({ type: 'terminal', data, width: 640, height: 380, position: dialog.at })
              setDialog(null)
            }}
          />
        )}
      </div>
    </StackContext.Provider>
    </CanvasContext.Provider>
  )
}

/** Current zoom; click to go back to 100%. */
function ZoomIndicator() {
  const { zoom } = useViewport()
  const { zoomTo, zoomIn, zoomOut } = useReactFlow()
  return (
    <span className="fw-zoom">
      <button title="Diminuir zoom" onClick={() => zoomOut({ duration: 150 })}>−</button>
      <button className="fw-zoom-value" title="Voltar para 100%" onClick={() => zoomTo(1, { duration: 150 })}>
        {Math.round(zoom * 100)}%
      </button>
      <button title="Aumentar zoom" onClick={() => zoomIn({ duration: 150 })}>+</button>
    </span>
  )
}

function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 })
    img.onerror = () => resolve({ width: 400, height: 300 })
    img.src = src
  })
}
