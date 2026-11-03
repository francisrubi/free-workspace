import type { Edge } from '@xyflow/react'
import { nodeTitle } from './nodeInfo'
import { uid, type FwNode, type NoteData, type TodoData } from './types'

type Result = { text: string; isError?: boolean; patch?: { id: string; data: Partial<NoteData> | Partial<TodoData> } }
type Element = Extract<FwNode, { type: 'note' | 'todo' }>

const fail = (text: string): Result => ({ text, isError: true })
const strings = (v: unknown) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : [])

/**
 * MCP tools on the notes and to-do lists connected to a session. Only what the user linked on the
 * canvas is reachable. Returns the tool's reply and, for a write, the change for the caller to apply.
 */
export function elementTool(nodes: FwNode[], edges: Edge[], from: string, tool: string, args: Record<string, unknown>): Result {
  const linked = edges.filter((e) => e.source === from || e.target === from).map((e) => (e.source === from ? e.target : e.source))
  const elements = nodes.filter((n): n is Element => (n.type === 'note' || n.type === 'todo') && linked.includes(n.id))

  if (tool === 'list_elements') {
    if (!elements.length) return { text: 'Nenhuma nota ou ToDo conectado a você. O usuário faz as conexões ligando os nós no canvas.' }
    return {
      text: elements
        .map((n) => (n.type === 'note' ? `- nota "${nodeTitle(n)}" (id ${n.id})` : `- ToDo "${nodeTitle(n)}" (id ${n.id}): ${n.data.items.filter((i) => i.done).length}/${n.data.items.length} feitas`))
        .join('\n')
    }
  }

  const wanted = String(args.element ?? '').trim()
  const found = elements.filter((n) => n.id === wanted || nodeTitle(n).toLowerCase() === wanted.toLowerCase())
  if (found.length > 1) return fail(`Há mais de um elemento chamado "${wanted}"; use o id (veja list_elements).`)
  const el = found[0]
  if (!el) {
    const known = elements.map((n) => `"${nodeTitle(n)}"`).join(', ') || 'nenhum'
    return fail(`Você não está conectado a um elemento "${wanted}". Conectados: ${known}.`)
  }

  if (tool === 'read_element') {
    if (el.type === 'note') return { text: el.data.text || '(nota vazia)' }
    return { text: `# ${el.data.title}\n` + (el.data.items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text} (id ${i.id})`).join('\n') || '(sem tarefas)') }
  }

  if (tool === 'write_note') {
    if (el.type !== 'note') return fail(`"${nodeTitle(el)}" é um ToDo: use update_todo.`)
    const text = String(args.text ?? '')
    if (!text.trim()) return fail('Texto vazio.')
    const next = args.mode === 'replace' || !el.data.text.trim() ? text : `${el.data.text.replace(/\s+$/, '')}\n\n${text}`
    return { text: `Nota "${nodeTitle(el)}" atualizada.`, patch: { id: el.id, data: { text: next } } }
  }

  if (tool === 'update_todo') {
    if (el.type !== 'todo') return fail(`"${nodeTitle(el)}" é uma nota: use write_note.`)
    const add = strings(args.add)
    const marks = [...strings(args.check).map((k) => [k, true] as const), ...strings(args.uncheck).map((k) => [k, false] as const)]
    if (!add.length && !marks.length) return fail('Informe add, check ou uncheck.')
    let items = el.data.items
    const missing: string[] = []
    for (const [key, done] of marks) {
      const hit = items.find((i) => i.id === key || i.text.toLowerCase() === key.toLowerCase())
      if (hit) items = items.map((i) => (i === hit ? { ...i, done } : i))
      else missing.push(key)
    }
    items = [...items, ...add.map((text) => ({ id: uid(), text, done: false }))]
    const notFound = missing.length ? ` Não encontradas: ${missing.map((m) => `"${m}"`).join(', ')}.` : ''
    return { text: `ToDo "${nodeTitle(el)}": ${items.filter((i) => i.done).length}/${items.length} feitas.${notFound}`, patch: { id: el.id, data: { items } } }
  }

  return fail(`Ferramenta desconhecida: ${tool}`)
}
