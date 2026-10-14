import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { DEFAULT_AGENT_INSTRUCTIONS, MESSAGE_TAG, type Settings } from '../shared/settings'

/**
 * Everything the app knows about AI sessions, served from one localhost HTTP server:
 *
 * - `/hook/…`: Claude Code HTTP hooks. Each Claude node is launched with its own settings
 *   file whose hooks call back here, so the app knows which conversation is live in that
 *   terminal (it changes on /clear or /resume) and can reopen exactly that one — `claude
 *   --continue` would pick the newest in the folder, wrong as soon as two sessions share a
 *   directory. SessionStart doesn't fire for HTTP hooks, so the id is learned on the first prompt.
 * - `/mcp/…`: a minimal MCP server (Streamable HTTP, hand-rolled JSON-RPC) that lets a session
 *   talk to the ones the user connected to it on the canvas. A message is delivered by typing
 *   it into the target's terminal; the reply is the target's `Stop` hook, which carries its
 *   last assistant message.
 *
 * Both URLs carry a per-run secret and the node id, so a request identifies its session.
 */

export type AgentInfo = { id: string; workspaceId: string; title: string; role?: string; cwd?: string; peers: string[] }

type Host = {
  dataDir: string
  settings: () => Settings
  /** Sends to the renderer. */
  send: (channel: string, payload: unknown) => void
  /** Types into a node's terminal; false when it has no live process. */
  write: (nodeId: string, text: string) => boolean
}

type Ask = {
  token: string
  from: string
  to: string
  /** The target's turn for this message has begun (its UserPromptSubmit carried the token). */
  started: boolean
  /** Null once the caller stopped waiting; the answer is then typed into its terminal. */
  reply: ((text: string) => void) | null
}

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const SERVER_NAME = 'free-workspace'
const ASK_TIMEOUT_MS = Number(process.env.FW_ASK_TIMEOUT_MS) || 10 * 60_000

const secret = randomUUID()
const agents = new Map<string, AgentInfo>()
const status = new Map<string, 'working' | 'idle'>()
let asks: Ask[] = []
let port = 0
let host: Host

export function startAgentServer(h: Host): Promise<void> {
  host = h
  const server = http.createServer((req, res) => {
    const [, kind, key, nodeId] = (req.url ?? '').split('/')
    if (req.method !== 'POST' || key !== secret || !UUID.test(nodeId ?? '')) {
      res.writeHead(req.method === 'POST' ? 403 : 405).end()
      return
    }
    let body = ''
    req.on('data', (c) => {
      if (body.length < 5_000_000) body += c
    })
    req.on('end', () => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(body)
      } catch {
        res.writeHead(400).end()
        return
      }
      if (kind === 'hook') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
        onHook(nodeId, msg)
      } else if (kind === 'mcp') onMcp(nodeId, msg, res)
      else res.writeHead(404).end()
    })
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port
      resolve()
    })
  )
}

/** The renderer owns the canvas, so it tells us who exists and who is connected to whom. */
export function syncAgents(workspaceId: string, list: AgentInfo[]): void {
  for (const [id, a] of agents) if (a.workspaceId === workspaceId) agents.delete(id)
  for (const a of list) if (UUID.test(a.id)) agents.set(a.id, { ...a, workspaceId })
}

/** Arguments appended to the node's `claude …` command: hooks, MCP, and the session to resume. */
export async function claudeArgs(nodeId: string, sessionId?: string): Promise<string> {
  if (!UUID.test(nodeId)) return ''
  const dir = path.join(host.dataDir, 'hooks')
  const base = `http://127.0.0.1:${port}`
  const hook = [{ hooks: [{ type: 'http', url: `${base}/hook/${secret}/${nodeId}` }] }]
  const mcp = host.settings().agentMcp
  await fs.mkdir(dir, { recursive: true })
  // Forward slashes: valid on Windows and safe inside double quotes in PowerShell, cmd and bash.
  const file = async (name: string, content: unknown) => {
    const p = path.join(dir, name)
    await fs.writeFile(p, JSON.stringify(content))
    return `"${p.replace(/\\/g, '/')}"`
  }
  let args = ` --settings ${await file(`${nodeId}.json`, {
    hooks: { UserPromptSubmit: hook, Stop: hook },
    // The user wired the sessions together on the canvas; don't ask again on every message.
    ...(mcp ? { permissions: { allow: [`mcp__${SERVER_NAME}`] } } : {})
  })}`
  if (mcp) {
    args += ` --mcp-config ${await file(`${nodeId}.mcp.json`, {
      mcpServers: { [SERVER_NAME]: { type: 'http', url: `${base}/mcp/${secret}/${nodeId}` } }
    })}`
  }
  return args + (sessionId && UUID.test(sessionId) ? ` --resume ${sessionId}` : '')
}

// ---------- hooks ----------

function onHook(nodeId: string, p: Record<string, unknown>): void {
  const sessionId = String(p.session_id ?? '')
  const event = String(p.hook_event_name ?? '')
  if (!UUID.test(sessionId)) return
  status.set(nodeId, event === 'UserPromptSubmit' ? 'working' : 'idle')
  host.send(`agent:event:${nodeId}`, { sessionId, event })

  if (event === 'UserPromptSubmit') {
    const prompt = String(p.prompt ?? '')
    const ask = asks.find((a) => a.to === nodeId && !a.started && prompt.includes(a.token))
    if (ask) ask.started = true
  } else if (event === 'Stop') {
    const ask = asks.find((a) => a.to === nodeId && a.started)
    if (ask) settle(ask, String(p.last_assistant_message ?? '').trim() || '(a sessão terminou o turno sem texto)')
  }
}

function settle(ask: Ask, text: string): void {
  asks = asks.filter((a) => a !== ask)
  host.send('agent:activity', { from: ask.from, to: ask.to, pending: false })
  if (ask.reply) ask.reply(text)
  else deliver(ask.from, `[${MESSAGE_TAG} resposta atrasada de "${name(ask.to)}"]\n${text}`)
}

// ---------- messaging ----------

const name = (id: string) => agents.get(id)?.title ?? id

/** Types a message into a session's terminal as a bracketed paste, then submits it. */
function deliver(nodeId: string, text: string): boolean {
  // No escape bytes: the text comes from a model and must not be able to drive the terminal.
  const ok = host.write(nodeId, `\x1b[200~${text.replace(/\x1b/g, '')}\x1b[201~`)
  // Enter separately, or the TUI takes it as part of the paste.
  if (ok) setTimeout(() => host.write(nodeId, '\r'), 250)
  return ok
}

function peer(fromId: string, wanted: string): AgentInfo | string {
  const peers = (agents.get(fromId)?.peers ?? []).map((id) => agents.get(id)).filter((a): a is AgentInfo => !!a)
  const key = wanted.trim().toLowerCase()
  const found = peers.filter((a) => a.id === wanted || a.title.toLowerCase() === key)
  if (found.length === 1) return found[0]
  const known = peers.map((a) => `"${a.title}"`).join(', ') || 'nenhuma'
  return found.length
    ? `Há mais de uma sessão chamada "${wanted}"; use o id (veja list_sessions).`
    : `Você não está conectado a uma sessão "${wanted}". Conectadas: ${known}. As conexões são feitas pelo usuário no canvas.`
}

function listSessions(fromId: string): string {
  const peers = (agents.get(fromId)?.peers ?? []).map((id) => agents.get(id)).filter((a): a is AgentInfo => !!a)
  if (!peers.length) return 'Nenhuma sessão conectada a você. O usuário faz as conexões ligando os nós no canvas.'
  return peers
    .map((a) =>
      [`- "${a.title}" (id ${a.id})`, `estado: ${status.get(a.id) === 'working' ? 'trabalhando' : 'ociosa'}`, a.role && `papel: ${a.role}`, a.cwd && `diretório: ${a.cwd}`]
        .filter(Boolean)
        .join(' · ')
    )
    .join('\n')
}

/** Resolves with the tool's text result. `onCancel` hands back what to call if the caller goes away. */
function ask(fromId: string, to: AgentInfo, message: string, onCancel: (fn: () => void) => void): Promise<string> {
  // A waits on B while B waits on A: neither turn can end. Refuse the second leg.
  if (asks.some((a) => a.from === to.id && a.to === fromId && a.reply))
    return Promise.resolve(`"${to.title}" está esperando a SUA resposta agora. Responda no texto final do seu turno em vez de perguntar de volta.`)

  const pending: Ask = { token: `${MESSAGE_TAG} ${randomUUID().slice(0, 8)}`, from: fromId, to: to.id, started: false, reply: null }
  const header = `[${pending.token}] Mensagem da sessão "${name(fromId)}". Ela está esperando: o texto final do seu turno será devolvido a ela.`
  if (!deliver(to.id, `${header}\n\n${message}`)) return Promise.resolve(`A sessão "${to.title}" não está rodando.`)

  asks.push(pending)
  host.send('agent:activity', { from: fromId, to: to.id, pending: true })
  return new Promise((resolve) => {
    const stopWaiting = (text: string) => {
      clearTimeout(timer)
      pending.reply = null
      resolve(text)
    }
    pending.reply = stopWaiting
    const timer = setTimeout(
      () => stopWaiting(`"${to.title}" ainda não respondeu. Siga com o que puder; a resposta será entregue aqui como mensagem quando chegar.`),
      ASK_TIMEOUT_MS
    )
    onCancel(() => stopWaiting(''))
  })
}

// ---------- MCP ----------

const sessionArg = { type: 'string', description: 'Nome (ou id) da sessão, como aparece em list_sessions.' }
const TOOLS = [
  {
    name: 'list_sessions',
    description: 'Lista as sessões de IA conectadas a você no canvas, com papel, estado e diretório de cada uma.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'ask_session',
    description:
      'Envia uma mensagem a uma sessão conectada e espera a resposta dela (o texto final do turno dela). Pode levar minutos. A outra sessão não vê a sua conversa: escreva tudo que ela precisa saber.',
    inputSchema: {
      type: 'object',
      properties: { session: sessionArg, message: { type: 'string', description: 'Pedido completo e autossuficiente.' } },
      required: ['session', 'message']
    }
  },
  {
    name: 'send_message',
    description: 'Envia um aviso a uma sessão conectada sem esperar resposta.',
    inputSchema: {
      type: 'object',
      properties: { session: sessionArg, message: { type: 'string' } },
      required: ['session', 'message']
    }
  }
]

function instructions(nodeId: string): string {
  const me = agents.get(nodeId)
  const base = host.settings().agentInstructions.trim() || DEFAULT_AGENT_INSTRUCTIONS
  return [base, me && `Nesta sessão você é "${me.title}".`, me?.role && `Seu papel: ${me.role}`].filter(Boolean).join('\n\n')
}

function onMcp(nodeId: string, msg: Record<string, unknown>, res: http.ServerResponse): void {
  const { id, method } = msg as { id?: unknown; method?: string }
  const params = (msg.params ?? {}) as Record<string, unknown>
  if (id === undefined) {
    res.writeHead(202).end() // a notification (e.g. notifications/initialized)
    return
  }
  const json = (body: object) =>
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, ...body }))
  const text = (t: string, isError = false) => ({ result: { content: [{ type: 'text', text: t }], isError } })

  if (method === 'initialize') {
    return void json({
      result: {
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: '0.1.0' },
        instructions: instructions(nodeId)
      }
    })
  }
  if (method === 'ping') return void json({ result: {} })
  if (method === 'tools/list') return void json({ result: { tools: TOOLS } })
  if (method !== 'tools/call') return void json({ error: { code: -32601, message: `Method not found: ${method}` } })

  const args = (params.arguments ?? {}) as { session?: string; message?: string }
  if (params.name === 'list_sessions') return void json(text(listSessions(nodeId)))
  if (params.name !== 'ask_session' && params.name !== 'send_message')
    return void json({ error: { code: -32602, message: `Unknown tool: ${params.name}` } })

  const target = peer(nodeId, String(args.session ?? ''))
  if (typeof target === 'string') return void json(text(target, true))
  const message = String(args.message ?? '').trim()
  if (!message) return void json(text('Mensagem vazia.', true))

  if (params.name === 'send_message') {
    const ok = deliver(target.id, `[${MESSAGE_TAG}] Aviso da sessão "${name(nodeId)}" (ela não espera resposta).\n\n${message}`)
    return void json(text(ok ? `Entregue a "${target.title}".` : `A sessão "${target.title}" não está rodando.`, !ok))
  }

  // ask_session can outlive HTTP header timeouts: answer as an SSE stream and keep it warm.
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const beat = setInterval(() => res.write(': aguardando\n\n'), 15_000)
  // If the caller goes away first, the answer is typed into its terminal when it arrives.
  let cancel = () => {}
  res.on('close', () => cancel())
  ask(nodeId, target, message, (fn) => (cancel = fn)).then((answer) => {
    clearInterval(beat)
    if (res.writableEnded || res.destroyed) return
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, ...text(answer) })}\n\n`)
  })
}
