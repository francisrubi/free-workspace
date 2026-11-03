import type { EditorState, Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import type { HttpRequest } from '../../../preload'
import { documentWidgets } from './editor'

/**
 * `.http` / `.rest` files, in the format of VS Code's REST Client: requests separated by `###`,
 * each a `METHOD url` line (the method is optional), headers, a blank line and the body, plus
 * `@name = value` variables used as `{{name}}`.
 */
export const isHttpFile = (name: string) => /\.(http|rest)$/i.test(name)

const METHOD = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s+(\S.*?)(?:\s+HTTP\/[\d.]+)?\s*$/i
const BARE_URL = /^(https?:\/\/\S+|\{\{[^}]+\}\}\S*)\s*$/i
const VARIABLE = /^@([\w.-]+)\s*=\s*(.*?)\s*$/
const COMMENT = /^\s*(#|\/\/)/
const SEPARATOR = /^###/

export type ParsedRequest = { label: string; lineNumber: number; method: string; url: string; headers: [string, string][]; body?: string }

function lines(state: EditorState): string[] {
  return state.doc.toJSON()
}

/** File variables: visible to every request, wherever they are declared. */
function variables(all: string[]): Map<string, string> {
  const vars = new Map<string, string>()
  for (const line of all) {
    const m = VARIABLE.exec(line)
    if (m) vars.set(m[1], m[2])
  }
  return vars
}

export function parseRequests(all: string[]): ParsedRequest[] {
  const out: ParsedRequest[] = []
  let i = 0
  while (i < all.length) {
    let label = ''
    if (SEPARATOR.test(all[i])) {
      label = all[i].replace(/^#+\s*/, '').trim()
      i++
    }
    // Up to the request line: comments (`# @name x` also labels it), variables, blank lines.
    while (i < all.length && !SEPARATOR.test(all[i]) && (!all[i].trim() || COMMENT.test(all[i]) || VARIABLE.test(all[i]))) {
      label ||= /^\s*(?:#|\/\/)\s*@name\s+(.+?)\s*$/.exec(all[i])?.[1] ?? ''
      i++
    }
    if (i >= all.length) break
    if (SEPARATOR.test(all[i])) continue

    const start = i
    const method = METHOD.exec(all[i])
    const bare = BARE_URL.exec(all[i])
    if (!method && !bare) {
      // Not a request: skip to the next separator instead of guessing.
      while (i < all.length && !SEPARATOR.test(all[i])) i++
      continue
    }
    let url = method ? method[2] : bare![1]
    i++
    // A long query can continue on the next lines.
    while (i < all.length && /^\s*[?&]/.test(all[i])) url += all[i++].trim()
    const headers: [string, string][] = []
    for (; i < all.length && all[i].trim() && !SEPARATOR.test(all[i]); i++) {
      if (COMMENT.test(all[i])) continue
      const colon = all[i].indexOf(':')
      if (colon > 0) headers.push([all[i].slice(0, colon).trim(), all[i].slice(colon + 1).trim()])
    }
    const body: string[] = []
    while (i < all.length && !SEPARATOR.test(all[i])) body.push(all[i++])
    const text = body.join('\n').trim()
    out.push({ label, lineNumber: start + 1, method: (method?.[1] ?? 'GET').toUpperCase(), url, headers, body: text || undefined })
  }
  return out
}

/** Fills `{{variables}}`; throws naming what isn't defined (better than sending it literally). */
export function resolveRequest(all: string[], r: ParsedRequest): HttpRequest {
  const vars = variables(all)
  const fill = (text: string, depth = 0): string =>
    text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, name: string) => {
      if (name === '$guid') return crypto.randomUUID()
      if (name === '$timestamp') return String(Math.floor(Date.now() / 1000))
      const value = vars.get(name)
      if (value === undefined || depth > 5) throw new Error(`Variável não definida neste arquivo: {{${name}}}`)
      return fill(value, depth + 1) // a variable may use others
    })
  return {
    method: r.method,
    url: fill(r.url),
    headers: r.headers.map(([k, v]) => [k, fill(v)]),
    body: r.body === undefined ? undefined : fill(r.body)
  }
}

class SendWidget extends WidgetType {
  constructor(
    private index: number,
    private title: string,
    private onSend: (index: number, all: string[]) => void
  ) {
    super()
  }
  eq(other: SendWidget) {
    return other.index === this.index && other.title === this.title
  }
  toDOM(view: EditorView) {
    const row = document.createElement('div')
    row.className = 'fw-http-send'
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = `▶ Enviar${this.title ? ` · ${this.title}` : ''}`
    // The document at click time: edits since the last render count.
    button.onclick = () => this.onSend(this.index, lines(view.state))
    row.append(button)
    return row
  }
}

/** A "send" button above each request of the document. */
export function httpActions(onSend: (index: number, all: string[]) => void): Extension {
  return documentWidgets((state) =>
    parseRequests(lines(state)).map((r, index) =>
      Decoration.widget({ widget: new SendWidget(index, r.label, onSend), block: true, side: -1 }).range(state.doc.line(r.lineNumber).from)
    )
  )
}
