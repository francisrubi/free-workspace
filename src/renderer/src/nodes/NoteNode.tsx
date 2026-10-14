import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import CodeMirror from '@uiw/react-codemirror'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { marked } from 'marked'
import { useMemo, useState } from 'react'
import type { FwNode } from '../types'
import { editorTheme } from './editor'
import { NodeFrame } from './NodeFrame'

type Props = NodeProps<Extract<FwNode, { type: 'note' }>>

const mdExtensions = [markdown({ codeLanguages: languages }), ...editorTheme]

export function NoteNode({ id, data, selected }: Props) {
  const { updateNodeData } = useReactFlow()
  const [editing, setEditing] = useState(!data.text)
  const html = useMemo(() => (editing ? '' : (marked.parse(data.text || '*Nota vazia*') as string)), [data.text, editing])
  const firstLine = data.text.split('\n')[0].replace(/^#+\s*/, '').slice(0, 60) || 'Nota'

  return (
    <NodeFrame
      id={id}
      selected={selected}
      icon="✎"
      title={data.title || firstLine}
      actions={<button onClick={() => setEditing(!editing)}>{editing ? 'ver' : 'editar'}</button>}
    >
      {editing ? (
        <CodeMirror
          className="fw-editor"
          value={data.text}
          autoFocus
          theme="none"
          basicSetup={{ lineNumbers: false, foldGutter: false }}
          extensions={mdExtensions}
          onChange={(text) => updateNodeData(id, { text })}
        />
      ) : (
        <div className="fw-markdown" onDoubleClick={() => setEditing(true)} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </NodeFrame>
  )
}
