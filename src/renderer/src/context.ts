import { createContext, useContext } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import type { MenuItem } from './ContextMenu'
import type { TerminalData, Workspace } from './types'

export const SettingsContext = createContext<Settings>(DEFAULT_SETTINGS)
export const useSettings = () => useContext(SettingsContext)

/** The live workspaces and which are loaded, for actions that cross workspaces (moving a node). */
export const WorkspacesContext = createContext<{ workspaces: Workspace[]; opened: string[] }>({ workspaces: [], opened: [] })
export const useWorkspaces = () => useContext(WorkspacesContext)

type MenuEvent = { clientX: number; clientY: number; preventDefault(): void }

/** Per-canvas state and actions that nodes need but that don't belong in node data. */
export type CanvasState = {
  workspaceId: string
  renamingId: string | null
  setRenamingId: (id: string | null) => void
  /** Shows a file on the canvas (focuses it if already there), next to node `from`. */
  openPath: (path: string, from?: string) => void
  /** Opens the new-terminal dialog with `cwd` filled in. */
  newTerminal: (kind: TerminalData['kind'], cwd: string) => void
  openMenu: (e: MenuEvent, items: MenuItem[]) => void
  /** Opens lazygit in `cwd` beside node `from` (or explains how to install it). */
  openLazygit: (cwd: string, from?: string) => void
}
export const CanvasContext = createContext<CanvasState>({
  workspaceId: '',
  renamingId: null,
  setRenamingId: () => {},
  openPath: () => {},
  newTerminal: () => {},
  openMenu: () => {},
  openLazygit: () => {}
})
export const useCanvas = () => useContext(CanvasContext)

export type Tab = { id: string; title: string; icon: string; color?: string; active: boolean }
/** Tab groups of the canvas: tabs by member id (only groups of 2+), and the tab actions. */
export type StackState = {
  tabsOf: Map<string, Tab[]>
  activate: (id: string) => void
  /** Takes a member out of its group, dropping it at a screen point. */
  detach: (id: string, clientX: number, clientY: number) => void
}
export const StackContext = createContext<StackState>({ tabsOf: new Map(), activate: () => {}, detach: () => {} })
export const useStack = () => useContext(StackContext)
