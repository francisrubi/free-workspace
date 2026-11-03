import type { Extension } from '@codemirror/state'
import { Decoration, WidgetType } from '@codemirror/view'
import { Marked } from 'marked'
import { documentWidgets } from './editor'

/** What the file node offers according to the file's type. */

export const isMarkdown = (name: string) => /\.(md|markdown)$/i.test(name)
export const isJson = (name: string) => /\.json$/i.test(name)
export const opensInBrowser = (name: string) => /\.(html?|svg)$/i.test(name)
export const isPackageJson = (name: string) => name.toLowerCase() === 'package.json'

// A file from any repo: its raw HTML could carry an `onerror` and reach window.api, so it is dropped.
const safeMarked = new Marked({ renderer: { html: () => '' } })
export const renderMarkdown = (text: string) => safeMarked.parse(text || '*Arquivo vazio*', { async: false })

// Names end up inside a command line; these can't expand in any shell's double quotes.
const SAFE_FILE = /^[\w .+@()-]+$/
const SAFE_SCRIPT = /^[\w:./+@-]+$/

type Runner = { command: string; shell?: (shells: { label: string; path: string }[]) => string | undefined }

/** How to run a script file in a terminal opened in its folder; null if it can't be run here. */
export function runnerFor(name: string): Runner | null {
  if (!SAFE_FILE.test(name)) return null
  const windows = !!window.api.windowsBuild
  if (/\.sh$/i.test(name)) return { command: `bash "./${name}"`, shell: (s) => (windows ? s.find((x) => x.label === 'Git Bash')?.path : undefined) }
  if (windows && /\.ps1$/i.test(name)) return { command: `& ".\\${name}"`, shell: () => 'powershell.exe' }
  if (windows && /\.(bat|cmd)$/i.test(name)) return { command: `".\\${name}"`, shell: () => 'cmd.exe' }
  return null
}

/**
 * Re-indents without going through JS values: JSON.parse + stringify would round big numbers and
 * reorder numeric keys. Throws if the text isn't valid JSON (e.g. a tsconfig with comments).
 */
export function formatJson(text: string): string {
  JSON.parse(text)
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:"]+/g) ?? []
  let out = ''
  let depth = 0
  const newline = () => '\n' + '  '.repeat(depth)
  tokens.forEach((token, i) => {
    if (token === '{' || token === '[') {
      const empty = tokens[i + 1] === '}' || tokens[i + 1] === ']'
      depth++
      out += token + (empty ? '' : newline())
    } else if (token === '}' || token === ']') {
      const empty = tokens[i - 1] === '{' || tokens[i - 1] === '['
      depth--
      out += (empty ? '' : newline()) + token
    } else if (token === ',') out += ',' + newline()
    else if (token === ':') out += ': '
    else out += token
  })
  return out + '\n'
}

class ScriptWidget extends WidgetType {
  constructor(
    private script: string,
    private onRun: (script: string) => void
  ) {
    super()
  }
  eq(other: ScriptWidget) {
    return other.script === this.script
  }
  toDOM() {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'fw-script-run'
    button.textContent = '▶'
    button.title = `Rodar "${this.script}" num terminal`
    button.onclick = () => this.onRun(this.script)
    return button
  }
}

/** A run button at the end of each line of package.json's `scripts`. */
export function packageScripts(onRun: (script: string) => void): Extension {
  return documentWidgets((state) => {
    const marks = []
    let inside = false
    for (let n = 1; n <= state.doc.lines; n++) {
      const line = state.doc.line(n)
      if (!inside) {
        inside = /^\s*"scripts"\s*:\s*\{\s*$/.test(line.text)
        continue
      }
      if (/^\s*\}/.test(line.text)) break
      const script = /^\s*"([^"]+)"\s*:/.exec(line.text)?.[1]
      if (script && SAFE_SCRIPT.test(script)) marks.push(Decoration.widget({ widget: new ScriptWidget(script, onRun), side: 1 }).range(line.to))
    }
    return marks
  })
}

/** The command for a script, with the package manager the folder's lockfile points to. */
export async function scriptCommand(dir: string, script: string): Promise<string> {
  const files = (await window.api.file.list(dir).catch(() => [])).map((f) => f.name)
  const manager = files.includes('pnpm-lock.yaml') ? 'pnpm' : files.includes('yarn.lock') ? 'yarn' : files.includes('bun.lock') || files.includes('bun.lockb') ? 'bun' : 'npm'
  return `${manager} run ${script}`
}
