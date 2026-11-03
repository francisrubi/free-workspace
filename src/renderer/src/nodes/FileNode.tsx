import { unifiedMergeView } from '@codemirror/merge'
import type { Extension } from '@codemirror/state'
import CodeMirror from '@uiw/react-codemirror'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HttpResponse } from '../../../preload'
import { useCanvas, useSettings } from '../context'
import type { FwNode } from '../types'
import { editorTheme, languageFor } from './editor'
import { formatJson, isJson, isMarkdown, isPackageJson, opensInBrowser, packageScripts, renderMarkdown, runnerFor, scriptCommand } from './fileTypes'
import { httpActions, isHttpFile, parseRequests, resolveRequest } from './httpFile'
import { NodeFrame } from './NodeFrame'

type Props = NodeProps<Extract<FwNode, { type: 'file' }>>
type Stale = { by?: string; gone?: boolean }
type HttpResult = { title: string; pending?: boolean; response?: HttpResponse; error?: string }

const POLL_MS = 2000
const samePath = (a: string, b: string) => {
  const norm = (p: string) => (window.api.windowsBuild ? p.replace(/\//g, '\\').toLowerCase() : p)
  return norm(a) === norm(b)
}
const prettyBody = (body: string) => {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

export function FileNode({ id, data, selected }: Props) {
  const [text, setText] = useState<string | null>(null)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const [lang, setLang] = useState<Extension[]>([])
  const [stale, setStale] = useState<Stale | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [http, setHttp] = useState<HttpResult | null>(null)
  const [diskVersion, setDiskVersion] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [problem, setProblem] = useState('')
  const { updateNodeData } = useReactFlow()
  const { watchExternalFiles } = useSettings()
  const { openTerminal } = useCanvas()
  const name = data.path.split(/[\\/]/).pop() ?? data.path
  const dir = data.path.slice(0, data.path.length - name.length - 1)
  const dirty = text !== null && text !== saved
  const runner = runnerFor(name)

  // What's known to be on disk, to tell a real change apart from a touch or from our own save.
  const savedRef = useRef('')
  const version = useRef<string | null>(null)
  const saving = useRef(false)
  const signature = async () => {
    const st = await window.api.file.stat(data.path)
    return st ? `${st.mtimeMs}:${st.size}` : 'gone'
  }

  const load = useCallback(async () => {
    try {
      // Stat first: if the file changes in between, the next check notices.
      const sig = await signature()
      const content = await window.api.file.read(data.path)
      version.current = sig
      savedRef.current = content
      setText(content)
      setSaved(content)
      setError('')
      setStale(null)
      setDismissed(false)
      setConflict(false)
      setDiskVersion(null)
    } catch (e) {
      setError(String(e))
    }
  }, [data.path])

  useEffect(() => {
    load()
    languageFor(name).then(setLang)
  }, [load, name])

  /** Compares the disk with the version this node has; `by` names the session that changed it. */
  const check = useCallback(
    async (by?: string) => {
      if (version.current === null || saving.current) return
      const sig = await signature()
      if (sig === version.current && !by) return
      if (saving.current) return
      version.current = sig
      if (sig === 'gone') return setStale({ gone: true })
      const content = await window.api.file.read(data.path).catch(() => null)
      if (content === null || saving.current) return
      if (content === savedRef.current) {
        setStale(null)
        return
      }
      setDismissed(false)
      setStale((cur) => ({ by: by ?? cur?.by }))
    },
    [data.path]
  )

  useEffect(() => {
    if (!watchExternalFiles) return
    const timer = setInterval(() => check(), POLL_MS)
    return () => clearInterval(timer)
  }, [check, watchExternalFiles])
  useEffect(() => window.api.file.onTouched((e) => samePath(e.path, data.path) && void check(e.by)), [check, data.path])

  // Renaming the node renames the file on disk, in the same folder.
  const rename = async (newName: string) => {
    if (/[\\/]/.test(newName)) throw new Error('Use só o nome, sem pasta')
    if (dirty) throw new Error('Salve as alterações antes de renomear')
    const newPath = data.path.slice(0, data.path.length - name.length) + newName
    await window.api.file.rename(data.path, newPath)
    updateNodeData(id, { path: newPath })
  }

  const write = async () => {
    if (text === null) return
    saving.current = true
    try {
      await window.api.file.write(data.path, text)
      savedRef.current = text
      version.current = await signature()
      setSaved(text)
      setStale(null)
      setConflict(false)
      setDiskVersion(null)
    } finally {
      saving.current = false
    }
  }

  // Checked against the disk here, not just the last poll: the file may have changed a moment ago.
  const save = async () => {
    if (text === null) return
    const disk = await window.api.file.read(data.path).catch(() => null)
    if (disk !== null && disk !== savedRef.current) {
      setConflict(true)
      return
    }
    await write()
  }

  const send = useRef((_index: number, _all: string[]) => {})
  send.current = async (index, all) => {
    const request = parseRequests(all)[index]
    if (!request) return
    const title = `${request.method} ${request.url}`
    try {
      const resolved = resolveRequest(all, request)
      setHttp({ title: `${resolved.method} ${resolved.url}`, pending: true })
      const response = await window.api.http.send(resolved)
      setHttp({ title: `${resolved.method} ${resolved.url}`, response })
    } catch (e) {
      setHttp({ title, error: (e as Error).message })
    }
  }
  const runScript = useRef((_script: string) => {})
  runScript.current = async (script) => openTerminal(dir, await scriptCommand(dir, script), script, undefined, id)
  const actions = useMemo(() => {
    if (isHttpFile(name)) return [httpActions((i, all) => send.current(i, all))]
    if (isPackageJson(name)) return [packageScripts((script) => runScript.current(script))]
    return []
  }, [name])

  const showDiff = async () => {
    const disk = await window.api.file.read(data.path).catch(() => null)
    if (disk === null) setProblem('Não foi possível ler a versão do disco.')
    else setDiskVersion(disk)
  }
  const format = () => {
    try {
      setText(formatJson(text ?? ''))
      setProblem('')
    } catch (e) {
      setProblem(`JSON inválido, nada foi alterado: ${(e as Error).message}`)
    }
  }
  const run = async () => {
    if (!runner) return
    const shells = await window.api.shells()
    openTerminal(dir, runner.command, name, runner.shell?.(shells), id)
  }
  const html = useMemo(() => (preview && text !== null ? renderMarkdown(text) : ''), [preview, text])
  // A link must not navigate the app's own window away.
  const onPreviewClick = (e: React.MouseEvent) => {
    const link = (e.target as HTMLElement).closest('a')
    if (!link) return
    e.preventDefault()
    const href = link.getAttribute('href') ?? ''
    if (/^https?:\/\//i.test(href)) window.api.shell.openUrl(href)
  }

  const notice = problem ? (
    <div className="fw-file-notice conflict">
      <span>{problem}</span>
      <button onClick={() => setProblem('')}>Ok</button>
    </div>
  ) : conflict ? (
    <div className="fw-file-notice conflict">
      <span>O arquivo mudou no disco depois que você o abriu. Salvar agora descarta a outra versão.</span>
      <button onClick={showDiff}>Ver diferenças</button>
      <button onClick={write}>Sobrescrever</button>
      <button onClick={load}>Recarregar do disco</button>
      <button onClick={() => setConflict(false)}>Cancelar</button>
    </div>
  ) : stale && !dismissed ? (
    <div className="fw-file-notice">
      <span>
        {stale.gone ? 'O arquivo não existe mais no disco.' : `Há uma nova versão no disco${stale.by ? `, alterada por "${stale.by}"` : ''}.`}
        {dirty && !stale.gone && ' Recarregar descarta suas edições.'}
      </span>
      {!stale.gone && <button onClick={showDiff}>Ver diferenças</button>}
      {!stale.gone && <button onClick={load}>Recarregar</button>}
      <button onClick={() => setDismissed(true)}>Ignorar</button>
    </div>
  ) : null

  return (
    <NodeFrame
      id={id}
      selected={selected}
      icon="📄"
      title={name}
      subtitle={[stale && (stale.gone ? 'apagado' : 'nova versão no disco'), dirty && 'não salvo', data.path].filter(Boolean).join(' · ')}
      onRename={rename}
      actions={
        <>
          {isMarkdown(name) && <button onClick={() => setPreview(!preview)}>{preview ? 'editar' : 'ver'}</button>}
          {isJson(name) && (
            <button title="Reindenta o JSON no editor; só vai para o disco ao salvar" disabled={text === null} onClick={format}>
              formatar
            </button>
          )}
          {runner && (
            <button title={dirty ? 'Salve antes: o terminal roda a versão do disco' : `Rodar ${name} num terminal`} disabled={dirty} onClick={run}>
              ▶ rodar
            </button>
          )}
          {opensInBrowser(name) && (
            <button title={dirty ? 'Salve antes: o navegador abre a versão do disco' : 'Abrir no navegador padrão'} disabled={dirty} onClick={() => window.api.shell.openInBrowser(data.path)}>
              ↗ navegador
            </button>
          )}
          <button className={stale && !stale.gone ? 'fw-stale' : ''} title={stale ? 'Há uma nova versão: recarregar do disco' : 'Recarregar do disco'} onClick={load}>
            ↻
          </button>
          <button title="Salvar (Ctrl+S)" disabled={!dirty} onClick={save}>
            salvar
          </button>
        </>
      }
      minWidth={320}
    >
      <div
        className="fw-file"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault()
            save()
          }
        }}
      >
        {notice}
        <div className="fw-file-editor">
          {error ? (
            <div className="fw-error">{error}</div>
          ) : text === null ? (
            <div className="fw-muted fw-pad">carregando…</div>
          ) : diskVersion !== null ? (
            <DiffView mine={text} disk={diskVersion} lang={lang} onClose={() => setDiskVersion(null)} />
          ) : preview ? (
            <div className="fw-markdown" onClick={onPreviewClick} dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <CodeMirror className="fw-editor" value={text} theme="none" extensions={[...lang, ...editorTheme, ...actions]} onChange={setText} />
          )}
        </div>
        {http && <HttpPanel result={http} onClose={() => setHttp(null)} />}
      </div>
    </NodeFrame>
  )
}

/** Read-only comparison in place of the editor: what's in this node vs what's on disk. */
function DiffView({ mine, disk, lang, onClose }: { mine: string; disk: string; lang: Extension[]; onClose: () => void }) {
  const extensions = useMemo(() => [...lang, ...editorTheme, unifiedMergeView({ original: mine, mergeControls: false })], [mine, lang])
  return (
    <div className="fw-diff">
      <div className="fw-diff-head">
        <span>
          <span className="fw-diff-mine">vermelho</span>: esta versão · <span className="fw-diff-disk">verde</span>: no disco
          {mine === disk && ' · sem diferenças'}
        </span>
        <button onClick={onClose}>Fechar</button>
      </div>
      <CodeMirror className="fw-editor" value={disk} editable={false} readOnly theme="none" extensions={extensions} />
    </div>
  )
}

function HttpPanel({ result, onClose }: { result: HttpResult; onClose: () => void }) {
  const { response, pending, error, title } = result
  const failed = error ?? response?.error
  return (
    <div className="fw-http-result">
      <div className="fw-http-head">
        {response?.status !== undefined && (
          <span className={`fw-http-status s${String(response.status)[0]}`}>
            {response.status} {response.statusText}
          </span>
        )}
        {response && <span className="fw-muted">{response.ms} ms</span>}
        <span className="fw-http-title fw-muted" title={title}>
          {title}
        </span>
        <button title="Fechar" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="fw-http-body">
        {pending ? (
          <div className="fw-muted">enviando…</div>
        ) : failed ? (
          <div className="fw-http-error">{failed}</div>
        ) : response?.status !== undefined ? (
          <>
            <details>
              <summary className="fw-muted">Headers ({response.headers.length})</summary>
              <pre>{response.headers.map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
            </details>
            <pre>{prettyBody(response.body)}</pre>
            {response.truncated && <div className="fw-muted">(resposta cortada em 2 MB)</div>}
          </>
        ) : null}
      </div>
    </div>
  )
}
