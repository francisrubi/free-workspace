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
import { CanvasContext, useSettings } from './context'
import { ExplorerNode } from './nodes/ExplorerNode'
import { FileNode } from './nodes/FileNode'
import { ImageNode } from './nodes/ImageNode'
import { NoteNode } from './nodes/NoteNode'
import { TerminalNode } from './nodes/TerminalNode'
import { TodoNode } from './nodes/TodoNode'
import { RoleDialog } from './RoleDialog'
import { TerminalDialog } from './TerminalDialog'
import { copySelection, pasteInto, terminals } from './terminals'
import { isClaude, uid, type FwNode, type TerminalData, type Workspace } from './types'

const nodeTypes = { terminal: TerminalNode, note: NoteNode, file: FileNode, image: ImageNode, todo: TodoNode, explorer: ExplorerNode }
const DRAG_HANDLE = '.fw-drag'
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i

/** `edges` connect Claude sessions that may talk to each other; a connection works both ways. */
type Saved = { nodes: FwNode[]; edges?: Edge[]; viewport: Viewport }
const pairKey = (a: string, b: string) => [a, b].sort().join('|')
type Point = { x: number; y: number }
type NewNode = Omit<FwNode, 'id' | 'position'> & { position?: Point }

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

  const center = (): Point => {
    const r = wrapper.current!.getBoundingClientRect()
    return screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  }
  /** Adds a node centred on `position` (or on the visible canvas). */
  const add = (node: NewNode) => {
    const c = node.position ?? center()
    const w = node.width ?? 400
    const h = node.height ?? 300
    const position = { x: c.x - w / 2, y: c.y - h / 2 }
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      { ...node, id: uid(), position, selected: true, dragHandle: DRAG_HANDLE } as FwNode
    ])
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
  useEffect(
    () =>
      window.api.onCanvasOpen(workspaceId, ({ from, item }) => {
        if (item.type === 'file') return void openPath(item.path, from)
        const src = getNodes().find((n) => n.id === from)
        const n = cascade.current.get(from) ?? 0
        cascade.current.set(from, n + 1)
        const w = item.type === 'terminal' ? 640 : item.type === 'note' ? 380 : 300
        const h = item.type === 'terminal' ? 380 : 300
        const at = src
          ? { x: src.position.x + (src.width ?? src.measured?.width ?? 400) + 40 + w / 2 + (n % 5) * 30, y: src.position.y + h / 2 + (n % 5) * 40 }
          : undefined
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
      { label: 'Cor…', onClick: () => pickColor(node) },
      ...(node.data.color ? [{ label: 'Usar a cor padrão do tipo', onClick: () => setNodeColor(node.id, undefined) }] : []),
      ...(specific.length ? (['sep', ...specific] as MenuItem[]) : []),
      'sep',
      { label: node.type === 'terminal' ? 'Remover (encerra o processo)' : 'Remover', danger: true, onClick: () => deleteElements({ nodes: [{ id: node.id }] }) }
    ]
  }

  const ctx = useMemo(
    () => ({ workspaceId, renamingId, setRenamingId, openPath, openMenu, newTerminal: (kind: TerminalData['kind'], cwd: string) => setDialog({ kind, cwd }) }),
    // openPath reads nodes through getNodes(), so it doesn't need to change with them.
    [workspaceId, renamingId]
  )

  if (loadError) return <div className="fw-error">Não foi possível abrir este workspace: {loadError}</div>
  if (!loaded) return null

  return (
    <CanvasContext.Provider value={ctx}>
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
          nodes={nodes}
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
