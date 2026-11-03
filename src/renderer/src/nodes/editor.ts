import { languages } from '@codemirror/language-data'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

/** Widgets derived from the document's text, rebuilt whenever it changes. */
export function documentWidgets(build: (state: EditorState) => Range<Decoration>[]): Extension {
  const set = (state: EditorState) => Decoration.set(build(state), true)
  return StateField.define<DecorationSet>({
    create: set,
    update: (value, tr) => (tr.docChanged ? set(tr.state) : value),
    provide: (f) => EditorView.decorations.from(f)
  })
}

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
