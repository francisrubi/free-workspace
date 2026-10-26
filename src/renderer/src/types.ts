import type { Node } from '@xyflow/react'

export type TerminalData = {
  title: string
  cwd?: string
  /** Runs once when the terminal is created (e.g. `ngrok http 3000`, `claude`). */
  command?: string
  /**
   * AI sessions with a `custom` provider: runs instead of `command` when reopened — app restart
   * or workspace back from stand-by (e.g. `codex resume --last`). Claude sessions don't use it.
   */
  resumeCommand?: string
  kind: 'shell' | 'ai'
  /**
   * `claude`: the app tracks the live conversation through hooks and reopens exactly that one
   * (`sessionId`). Absent on nodes created before this existed; see `isClaude`.
   */
  provider?: 'claude' | 'custom'
  /** What this session is for; shown to the sessions connected to it (MCP `list_sessions`). */
  role?: string
  /** Last Claude conversation used in this terminal, reported by its hooks. */
  sessionId?: string
  started?: boolean
  /** Overrides the kind's default color (Settings). Same field on every node type. */
  color?: string
}

export const isClaude = (d: TerminalData) =>
  d.kind === 'ai' && (d.provider === 'claude' || (d.provider === undefined && /^claude(\s|$)/.test(d.command ?? '')))
/** `title` overrides the note's first line as its header. */
export type NoteData = { text: string; title?: string; color?: string }
/** The header is the file name; renaming it renames the file on disk. */
export type FileData = { path: string; color?: string }
export type ImageData = { src: string; title?: string; color?: string }
export type TodoData = { title: string; items: { id: string; text: string; done: boolean }[]; color?: string }
/** `open`: expanded folders, kept so the tree reopens the same way. */
export type ExplorerData = { root: string; title?: string; open?: string[]; color?: string }

/**
 * Tab groups are visual only: members stay separate nodes (their terminals keep running) and
 * share one spot on the canvas; only the active one is shown, with every member as a tab.
 */
export type Stackable = { stack?: string; stackActive?: boolean }

export type FwNode =
  | Node<TerminalData & Stackable, 'terminal'>
  | Node<NoteData & Stackable, 'note'>
  | Node<FileData & Stackable, 'file'>
  | Node<ImageData & Stackable, 'image'>
  | Node<TodoData & Stackable, 'todo'>
  | Node<ExplorerData & Stackable, 'explorer'>

/** `deletedAt`: in the trash since then (see settings.trashDays). */
export type Workspace = { id: string; name: string; createdAt: string; cwd?: string; deletedAt?: string | null }

export const uid = () => crypto.randomUUID()
