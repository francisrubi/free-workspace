import { languages } from '@codemirror/language-data'
import type { Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'

export const editorTheme: Extension[] = [
  oneDark,
  EditorView.theme({
    '&': { height: '100%', fontSize: '13px', backgroundColor: 'transparent' },
    '.cm-scroller': { fontFamily: '"Cascadia Mono", Consolas, monospace' },
    '.cm-gutters': { backgroundColor: 'transparent' }
  })
]

/** Resolves syntax highlighting from the file name (lazy-loads the grammar). */
export async function languageFor(filename: string): Promise<Extension[]> {
  const desc = languages.find((l) => l.extensions.some((ext) => filename.toLowerCase().endsWith('.' + ext)))
    ?? languages.find((l) => l.filename?.test(filename))
  return desc ? [await desc.load()] : []
}
