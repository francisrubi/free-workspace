import { useReactFlow, type NodeProps } from '@xyflow/react'
import { useState } from 'react'
import { uid, type FwNode, type TodoData } from '../types'
import { NodeFrame } from './NodeFrame'

type Props = NodeProps<Extract<FwNode, { type: 'todo' }>>

export function TodoNode({ id, data, selected }: Props) {
  const { updateNodeData } = useReactFlow()
  const [draft, setDraft] = useState('')
  const setItems = (items: TodoData['items']) => updateNodeData(id, { items })
  const done = data.items.filter((i) => i.done).length

  return (
    <NodeFrame
      id={id}
      selected={selected}
      icon="☑"
      title={data.title}
      actions={<span className="fw-muted">{done}/{data.items.length}</span>}
      minWidth={220}
    >
      <div className="fw-todo">
        {data.items.map((item) => (
          <label key={item.id} className={item.done ? 'done' : ''}>
            <input
              type="checkbox"
              checked={item.done}
              onChange={() => setItems(data.items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))}
            />
            <span>{item.text}</span>
            <button onClick={() => setItems(data.items.filter((i) => i.id !== item.id))}>×</button>
          </label>
        ))}
        <input
          className="fw-todo-new"
          placeholder="+ nova tarefa (Enter)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              setItems([...data.items, { id: uid(), text: draft.trim(), done: false }])
              setDraft('')
            }
          }}
        />
      </div>
    </NodeFrame>
  )
}
