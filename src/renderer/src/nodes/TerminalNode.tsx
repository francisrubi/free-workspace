import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import { useCanvas, useSettings } from '../context'
import { copySelection, gitInfo, terminals } from '../terminals'
import { isClaude, type FwNode, type TerminalData } from '../types'
import { Composer } from './Composer'
import { NodeFrame } from './NodeFrame'
import type { GitInfo } from '../../../preload'

type Props = NodeProps<Extract<FwNode, { type: 'terminal' }>>

export function TerminalNode({ id, data, selected }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const { updateNodeData } = useReactFlow()
  const { workspaceId } = useCanvas()
  const { composer } = useSettings()
  const [generation, setGeneration] = useState(0)
  const [status, setStatus] = useState<'working' | 'idle'>()
  const [git, setGit] = useState<GitInfo | null>(null)
  const dataRef = useRef<TerminalData>(data)
  dataRef.current = data

  useEffect(() => {
    const d = dataRef.current
    // Default DOM renderer on purpose: it is plain text, so it stays sharp under the
    // canvas `scale()` transform at any zoom (a WebGL canvas would blur above 100%).
    const term = new Terminal({
      fontSize: 13,
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      scrollback: 5000,
      cursorBlink: true,
      theme: { background: '#0f1115', foreground: '#d6d9e0', selectionBackground: '#3a4252' },
      // ConPTY repaints the screen itself on resize. Without this, growing the node makes xterm
      // pull scrollback into the new rows while ConPTY paints over them: lines get lost or
      // duplicated (the "text multiplies when I expand it" bug, also seen in Maestri).
      windowsPty: window.api.windowsBuild ? { backend: 'conpty', buildNumber: window.api.windowsBuild } : undefined
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el.current!)
    safeFit(fit, el.current!)

    // Windows Terminal behaviour: Ctrl+C copies when there is a selection (otherwise it is
    // ^C for the process). For Ctrl+V xterm just skips the key so the browser fires a real
    // paste event: text goes to the terminal, an image goes to the canvas (Canvas listener).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !(e.ctrlKey || e.metaKey)) return true
      const key = e.key.toLowerCase()
      if (key === 'c' && (e.shiftKey || term.hasSelection())) {
        copySelection(term)
        e.preventDefault()
        return false
      }
      return key !== 'v'
    })

    const offData = window.api.pty.onData(id, (chunk) => term.write(chunk))
    const offExit = window.api.pty.onExit(id, (code) =>
      term.write(`\r\n\x1b[90m[processo encerrado: ${code}]\x1b[0m\r\n`)
    )
    // AI sessions resume their chat when reopened; a live PTY ignores the command. Claude gets
    // `--resume <sessionId>` appended by the main process. A node from before session tracking
    // has no id yet, so it falls back once to its old `claude --continue`.
    const claude = isClaude(d)
    const reopening = d.kind === 'ai' && d.started
    const command = reopening && (!claude || !d.sessionId) && d.resumeCommand ? d.resumeCommand : d.command
    window.api.pty
      .open({ id, workspaceId, cwd: d.cwd, command, claude: claude ? { sessionId: d.sessionId } : undefined, cols: term.cols, rows: term.rows })
      .then(({ replay }) => {
        if (replay) {
          term.write(replay)
          // Re-attached to a running process (workspace switch or move): the replayed bytes can
          // leave a full-screen program (Claude Code, lazygit) half drawn. Nudging the size makes
          // it redraw the whole screen.
          window.api.pty.resize(id, term.cols, Math.max(1, term.rows - 1))
          setTimeout(() => window.api.pty.resize(id, term.cols, term.rows), 80)
        }
        if (!d.started) updateNodeData(id, { started: true })
      })
    const inSub = term.onData((s) => window.api.pty.write(id, s))
    const rsSub = term.onResize(({ cols, rows }) => window.api.pty.resize(id, cols, rows))
    const ro = new ResizeObserver(() => safeFit(fit, el.current!))
    ro.observe(el.current!)

    terminals.set(id, {
      term,
      restart: () => {
        window.api.pty.kill(id)
        setGeneration((g) => g + 1)
      }
    })

    return () => {
      // A moved node mounts in the other canvas with the same id, possibly before this unmounts.
      if (terminals.get(id)?.term === term) terminals.delete(id)
      ro.disconnect()
      inSub.dispose()
      rsSub.dispose()
      offData()
      offExit()
      term.dispose()
    }
  }, [id, workspaceId, updateNodeData, generation])

  // Hooks tell us which conversation is live here (it changes on /clear) and whether it is busy.
  useEffect(() => {
    if (!isClaude(dataRef.current)) return
    return window.api.onAgentEvent(id, ({ sessionId, event }) => {
      // Only ids of conversations with a message: --resume can't open an empty one (SessionStart
      // reports the id as soon as the CLI starts).
      if (event !== 'SessionStart' && sessionId !== dataRef.current.sessionId) updateNodeData(id, { sessionId })
      setStatus(event === 'UserPromptSubmit' ? 'working' : 'idle')
    })
  }, [id, updateNodeData, data.provider, data.command])

  // Branch of the node's directory; polled because checkouts happen inside the terminal.
  useEffect(() => {
    if (!data.cwd) return
    const cwd = data.cwd
    let alive = true
    const refresh = () =>
      window.api.git.info(cwd).then((g) => {
        if (!alive) return
        setGit(g)
        if (g) gitInfo.set(id, g)
        else gitInfo.delete(id)
      })
    refresh()
    const timer = setInterval(refresh, 15000)
    window.addEventListener('fw:git-changed', refresh)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('fw:git-changed', refresh)
      gitInfo.delete(id)
    }
  }, [id, data.cwd])

  const where = git ? `⎇ ${git.branch}${git.worktree ? ' (worktree)' : ''}` : undefined

  return (
    <>
      {/* Drag from one session's dot to another's to let them talk (see main/agents.ts).
          Outside NodeFrame, whose overflow:hidden would clip them. */}
      {isClaude(data) && (
        <>
          <Handle id="l" type="source" position={Position.Left} className="fw-handle" title="Arraste até outra sessão para conectá-las" />
          <Handle id="r" type="source" position={Position.Right} className="fw-handle" title="Arraste até outra sessão para conectá-las" />
        </>
      )}
    <NodeFrame
      id={id}
      selected={selected}
      icon={data.kind === 'ai' ? '✦' : '›_'}
      status={status}
      title={data.title}
      subtitle={[data.role, where, data.cwd].filter(Boolean).join(' · ') || undefined}
      minWidth={320}
      minHeight={160}
    >
      <div className="fw-terminal" ref={el} />
    </NodeFrame>
      {composer && <Composer nodeId={id} visible={!!selected} />}
    </>
  )
}

function safeFit(fit: FitAddon, el: HTMLElement) {
  // A hidden (stand-by) or not-yet-laid-out terminal would fit to 0 cols and reflow the PTY.
  if (!el.offsetWidth || !el.offsetHeight) return
  try {
    fit.fit()
  } catch {
    /* renderer not ready yet */
  }
}
