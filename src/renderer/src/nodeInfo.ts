import type { FwNode } from './types'

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** What a node is called in its header and in a tab group. */
export function nodeTitle(n: FwNode): string {
  switch (n.type) {
    case 'terminal':
      return n.data.title
    case 'note':
      return n.data.title || n.data.text.split('\n')[0].replace(/^#+\s*/, '').slice(0, 60) || 'Nota'
    case 'file':
      return baseName(n.data.path)
    case 'image':
      return n.data.title || 'Screenshot'
    case 'todo':
      return n.data.title
    case 'explorer':
      return n.data.title || baseName(n.data.root)
  }
}

export function nodeIcon(n: FwNode): string {
  switch (n.type) {
    case 'terminal':
      return n.data.kind === 'ai' ? '✦' : '›_'
    case 'note':
      return '✎'
    case 'file':
      return '📄'
    case 'image':
      return '▣'
    case 'todo':
      return '☑'
    case 'explorer':
      return '🗂'
  }
}
