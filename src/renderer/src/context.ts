import { createContext, useContext } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import type { MenuItem } from './ContextMenu'
import type { TerminalData } from './types'

export const SettingsContext = createContext<Settings>(DEFAULT_SETTINGS)
export const useSettings = () => useContext(SettingsContext)

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
}
export const CanvasContext = createContext<CanvasState>({
  workspaceId: '',
  renamingId: null,
  setRenamingId: () => {},
  openPath: () => {},
  newTerminal: () => {},
  openMenu: () => {}
})
export const useCanvas = () => useContext(CanvasContext)
