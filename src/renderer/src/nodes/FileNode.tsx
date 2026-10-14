import type { Extension } from '@codemirror/state'
import CodeMirror from '@uiw/react-codemirror'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { useCallback, useEffect, useState } from 'react'
import type { FwNode } from '../types'
import { editorTheme, languageFor } from './editor'
import { NodeFrame } from './NodeFrame'

type Props = NodeProps<Extract<FwNode, { type: 'file' }>>

export function FileNode({ id, data, selected }: Props) {
  const [text, setText] = useState<string | null>(null)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const [lang, setLang] = useState<Extension[]>([])
  const { updateNodeData } = useReactFlow()
  const name = data.path.split(/[\\/]/).pop() ?? data.path
  const dirty = text !== null && text !== saved

  const load = useCallback(async () => {
    try {
      const content = await window.api.file.read(data.path)
      setText(content)
      setSaved(content)
      setError('')
    } catch (e) {
      setError(String(e))
    }
  }, [data.path])

  useEffect(() => {
    load()
    languageFor(name).then(setLang)
  }, [load, name])

  // Renaming the node renames the file on disk, in the same folder.
  const rename = async (newName: string) => {
    if (/[\\/]/.test(newName)) throw new Error('Use só o nome, sem pasta')
    if (dirty) throw new Error('Salve as alterações antes de renomear')
    const newPath = data.path.slice(0, data.path.length - name.length) + newName
    await window.api.file.rename(data.path, newPath)
    updateNodeData(id, { path: newPath })
  }

  const save = async () => {
    if (text === null) return
    await window.api.file.write(data.path, text)
    setSaved(text)
  }

  return (
    <NodeFrame
      id={id}
      selected={selected}
      icon="📄"
      title={name}
      subtitle={dirty ? `não salvo · ${data.path}` : data.path}
      onRename={rename}
      actions={
        <>
          <button title="Recarregar do disco" onClick={load}>
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
        className="fw-fill"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault()
            save()
          }
        }}
      >
        {error ? (
          <div className="fw-error">{error}</div>
        ) : text === null ? (
          <div className="fw-muted fw-pad">carregando…</div>
        ) : (
          <CodeMirror className="fw-editor" value={text} theme="none" extensions={[...lang, ...editorTheme]} onChange={setText} />
        )}
      </div>
    </NodeFrame>
  )
}
