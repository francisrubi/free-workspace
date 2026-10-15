/** Node kinds that can get their own default color (Settings) — a terminal and an AI session differ. */
export const COLOR_KINDS = [
  ['terminal', 'Terminal'],
  ['ai', 'Sessão IA'],
  ['note', 'Nota'],
  ['todo', 'ToDo'],
  ['file', 'Arquivo'],
  ['image', 'Print'],
  ['explorer', 'Explorador']
] as const

export type ColorKind = (typeof COLOR_KINDS)[number][0]

/** Default color per kind; a kind left out keeps the neutral look. */
export type NodeColors = Partial<Record<ColorKind, string>>

export function colorKind(type: string | undefined, data: Record<string, unknown>): ColorKind | undefined {
  if (type === 'terminal') return data.kind === 'ai' ? 'ai' : 'terminal'
  return COLOR_KINDS.some(([k]) => k === type) ? (type as ColorKind) : undefined
}

/** The node's own color, else its kind's default from Settings, else none. */
export function nodeColor(type: string | undefined, data: Record<string, unknown>, defaults: NodeColors): string | undefined {
  if (typeof data.color === 'string' && data.color) return data.color
  const kind = colorKind(type, data)
  return kind ? defaults[kind] : undefined
}

/** Picked in turn for new sidebar groups. */
export const GROUP_PALETTE = ['#7aa2f7', '#9ece6a', '#e0af68', '#f7768e', '#bb9af7', '#7dcfff', '#ff9e64']
