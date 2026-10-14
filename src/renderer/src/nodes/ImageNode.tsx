import type { NodeProps } from '@xyflow/react'
import type { FwNode } from '../types'
import { NodeFrame } from './NodeFrame'

type Props = NodeProps<Extract<FwNode, { type: 'image' }>>

export function ImageNode({ id, data, selected }: Props) {
  return (
    <NodeFrame id={id} selected={selected} icon="▣" title={data.title || 'Screenshot'} minWidth={80} minHeight={60}>
      <img className="fw-image" src={data.src} draggable={false} />
    </NodeFrame>
  )
}
