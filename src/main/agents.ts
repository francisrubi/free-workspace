import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { promisify } from 'node:util'
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
/**
 * Claude sessions whose CLI has started (SessionStart hook). Until then, text typed into the
 * terminal would land in the shell, so messages to a session wait for it (see whenReady).
 */
const ready = new Set<string>()
const readyWaiters = new Map<string, (() => void)[]>()
const READY_TIMEOUT_MS = Number(process.env.FW_READY_TIMEOUT_MS) || 60_000
/** Sessions each session opened with open_session, to cap it. */
const spawned = new Map<string, number>()
const MAX_SPAWNED = 3
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
  const url = `${base}/hook/${secret}/${nodeId}`
  const hook = [{ hooks: [{ type: 'http', url }] }]
  // SessionStart doesn't fire for HTTP hooks; as a command hook it does. curl.exe ships with
  // Windows 10+, and the bare `curl` in Windows PowerShell would be an Invoke-WebRequest alias.
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl'
  const startHook = [{ hooks: [{ type: 'command', command: `${curl} -s -X POST --data-binary @- ${url}` }] }]
  ready.delete(nodeId) // (re)launching: not ready until its SessionStart arrives
  const mcp = host.settings().agentMcp
  await fs.mkdir(dir, { recursive: true })
  // Forward slashes: valid on Windows and safe inside double quotes in PowerShell, cmd and bash.
  const file = async (name: string, content: unknown) => {
    const p = path.join(dir, name)
    await fs.writeFile(p, JSON.stringify(content))
    return `"${p.replace(/\\/g, '/')}"`
  }
  let args = ` --settings ${await file(`${nodeId}.json`, {
    hooks: { SessionStart: startHook, UserPromptSubmit: hook, Stop: hook },
    // The user wired the sessions together and the canvas is theirs to look at: no prompt for
    // these. open_terminal is left out on purpose — it runs a command, so Claude Code asks
    // first, as it would for its own Bash tool.
    ...(mcp ? { permissions: { allow: PRE_ALLOWED.map((t) => `mcp__${SERVER_NAME}__${t}`) } } : {})
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
  if (event === 'SessionStart') {
    ready.add(nodeId)
    for (const wake of readyWaiters.get(nodeId) ?? []) wake()
    readyWaiters.delete(nodeId)
  }
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
/** Resolves true once the session's CLI is up (immediately if it already is). */
function whenReady(nodeId: string): Promise<boolean> {
  if (ready.has(nodeId)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(ready.has(nodeId)), READY_TIMEOUT_MS)
    readyWaiters.set(nodeId, [...(readyWaiters.get(nodeId) ?? []), () => (clearTimeout(timer), resolve(true))])
  })
}

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
async function ask(fromId: string, to: AgentInfo, message: string, onCancel: (fn: () => void) => void): Promise<string> {
  // A waits on B while B waits on A: neither turn can end. Refuse the second leg.
  if (asks.some((a) => a.from === to.id && a.to === fromId && a.reply))
    return Promise.resolve(`"${to.title}" está esperando a SUA resposta agora. Responda no texto final do seu turno em vez de perguntar de volta.`)

  const pending: Ask = { token: `${MESSAGE_TAG} ${randomUUID().slice(0, 8)}`, from: fromId, to: to.id, started: false, reply: null }
  const header = `[${pending.token}] Mensagem da sessão "${name(fromId)}". Ela está esperando: o texto final do seu turno será devolvido a ela.`
  if (!(await whenReady(to.id))) return `A sessão "${to.title}" não terminou de iniciar a tempo. Tente de novo em instantes.`
  if (!deliver(to.id, `${header}\n\n${message}`)) return `A sessão "${to.title}" não está rodando.`

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

// ---------- canvas tools ----------
// Let a session put things in front of the user, next to itself on the canvas. The renderer
// that owns the session's workspace does the placing (see Canvas.tsx, `canvas:open`).

const CANVAS_TOOLS: { name: string; description: string; inputSchema: object }[] = [
  {
    name: 'open_file',
    description:
      'Abre um arquivo no canvas do usuário, ao lado desta sessão (se já estiver aberto, foca nele). Use para mostrar um arquivo que vale o usuário ler ou revisar. Imagens viram print.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Caminho absoluto ou relativo ao diretório desta sessão.' } },
      required: ['path']
    }
  },
  {
    name: 'create_note',
    description: 'Cria uma nota em Markdown no canvas, ao lado desta sessão. Use para resumos, planos ou decisões que o usuário deve manter à vista.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Conteúdo em Markdown.' }, title: { type: 'string', description: 'Opcional; sem ele, o título é a 1ª linha.' } },
      required: ['text']
    }
  },
  {
    name: 'create_todo',
    description: 'Cria uma lista de tarefas (ToDo) no canvas, ao lado desta sessão, para o usuário acompanhar e marcar.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'string' }, description: 'Uma tarefa por item.' } },
      required: ['title', 'items']
    }
  },
  {
    name: 'open_terminal',
    description:
      'Abre um terminal no canvas, ao lado desta sessão, opcionalmente já rodando um comando (ex.: servidor de dev, logs, ngrok) que o usuário vai querer ver. O usuário confirma antes.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        cwd: { type: 'string', description: 'Diretório; padrão: o desta sessão.' },
        command: { type: 'string', description: 'Comando a rodar ao abrir (opcional).' }
      },
      required: ['title']
    }
  }
]
const OPEN_SESSION_TOOL = {
  name: 'open_session',
  description:
    'Abre uma nova sessão Claude Code no canvas, já conectada a você. Use SOMENTE quando o usuário pedir explicitamente para delegar ou paralelizar trabalho numa nova sessão. ' +
    `Limites: no máximo ${MAX_SPAWNED} por sessão; o diretório precisa ser o seu (ou uma subpasta) ou uma worktree do mesmo repositório; effort medium ou high. ` +
    'O usuário confirma antes. Passe a tarefa em `task` ou depois com ask_session/send_message (eles esperam a nova sessão terminar de iniciar).',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Nome curto da sessão no canvas.' },
      role: { type: 'string', description: 'O que ela vai fazer (as sessões conectadas veem isso).' },
      cwd: { type: 'string', description: 'Diretório; padrão: o desta sessão. Relativo a ele ou absoluto.' },
      effort: { type: 'string', enum: ['medium', 'high'], description: 'Padrão: medium.' },
      task: { type: 'string', description: 'Opcional: a primeira mensagem para a nova sessão, entregue assim que ela estiver pronta. Autossuficiente.' }
    },
    required: ['title', 'role']
  }
}
CANVAS_TOOLS.push(OPEN_SESSION_TOOL)
// open_terminal and open_session are left out: they start processes, so Claude Code asks first.
const PRE_ALLOWED = ['list_sessions', 'ask_session', 'send_message', 'open_file', 'create_note', 'create_todo']
const CANVAS_TOOL_NAMES = new Set(CANVAS_TOOLS.map((t) => t.name))

type CanvasItem =
  | { type: 'file'; path: string }
  | { type: 'note'; text: string; title?: string }
  | { type: 'todo'; title: string; items: string[] }
  | { type: 'terminal'; title: string; cwd?: string; command?: string }
  | { type: 'session'; id: string; title: string; role: string; cwd: string; command: string }

/** Validates a canvas tool call and hands it to the renderer; returns the tool's text reply. */
async function canvasTool(nodeId: string, tool: string, a: Record<string, unknown>): Promise<[string, boolean]> {
  const me = agents.get(nodeId)
  if (!me) return ['Esta sessão não está num canvas aberto.', true]
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const within = (p: string) => path.resolve(me.cwd ?? '', p)
  let item: CanvasItem
  if (tool === 'open_file') {
    const file = within(str(a.path))
    const st = await fs.stat(file).catch(() => null)
    if (!st?.isFile()) return [`Arquivo não encontrado: ${file}`, true]
    item = { type: 'file', path: file }
  } else if (tool === 'create_note') {
    if (!str(a.text)) return ['Nota vazia.', true]
    item = { type: 'note', text: str(a.text), title: str(a.title) || undefined }
  } else if (tool === 'create_todo') {
    const items = Array.isArray(a.items) ? a.items.map(str).filter(Boolean) : []
    if (!items.length) return ['Informe ao menos uma tarefa.', true]
    item = { type: 'todo', title: str(a.title) || 'ToDo', items }
  } else if (tool === 'open_session') {
    const made = spawned.get(nodeId) ?? 0
    if (made >= MAX_SPAWNED) return [`Limite atingido: esta sessão já abriu ${MAX_SPAWNED} sessões.`, true]
    const effort = str(a.effort) || 'medium'
    if (effort !== 'medium' && effort !== 'high') return ['effort precisa ser medium ou high.', true]
    if (!str(a.title) || !str(a.role)) return ['Informe title e role.', true]
    const cwd = within(str(a.cwd))
    const st = await fs.stat(cwd).catch(() => null)
    if (!st?.isDirectory()) return [`Diretório não encontrado: ${cwd}`, true]
    if (!(await sameProject(me.cwd ?? '', cwd)))
      return [`Fora do permitido: use o seu diretório (${me.cwd}), uma subpasta dele ou uma worktree do mesmo repositório.`, true]
    spawned.set(nodeId, made + 1)
    // FW_CLAUDE_BIN lets the e2e test stand in for the real CLI.
    const command = `${process.env.FW_CLAUDE_BIN || 'claude'} --effort ${effort}`
    // The id is chosen here so the task can be delivered to that node once it's up.
    item = { type: 'session', id: randomUUID(), title: str(a.title), role: str(a.role), cwd, command }
    const task = str(a.task)
    if (task) {
      const id = item.id
      whenReady(id).then((isReady) => isReady && deliver(id, `[${MESSAGE_TAG}] Tarefa da sessão "${name(nodeId)}", que abriu você.\n\n${task}`))
    }
  } else {
    // A `claude` started this way is a plain terminal to the app: no hooks, no MCP, nothing
    // to connect to. That's what open_session is for.
    if (/^\s*(npx\s+(-y\s+)?@anthropic-ai\/claude-code|claude(\.exe|\.cmd)?)(\s|$)/i.test(str(a.command)))
      return ['Para abrir uma sessão de IA use open_session: um terminal rodando claude não fica conectado nem recebe estas ferramentas.', true]
    const cwd = within(str(a.cwd))
    const st = await fs.stat(cwd).catch(() => null)
    if (!st?.isDirectory()) return [`Diretório não encontrado: ${cwd}`, true]
    item = { type: 'terminal', title: str(a.title) || 'Terminal', cwd, command: str(a.command) || undefined }
  }
  host.send(`canvas:open:${me.workspaceId}`, { from: nodeId, item })
  if (item.type === 'session')
    return [
      `Sessão "${item.title}" aberta em ${item.cwd} e conectada a você.` +
        (str(a.task) ? ' A tarefa será entregue assim que ela iniciar.' : ' Ela leva alguns segundos para iniciar; ask_session e send_message esperam por isso.'),
      false
    ]
  return ['Pronto: aberto no canvas, ao lado desta sessão.', false]
}

const gitDir = async (dir: string) => {
  try {
    const { stdout } = await promisify(execFile)('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir, windowsHide: true })
    return path.resolve(stdout.trim()).toLowerCase()
  } catch {
    return null
  }
}

/** `dir` is `base` or inside it, or a worktree of the same repository as `base`. */
async function sameProject(base: string, dir: string): Promise<boolean> {
  if (!base) return false
  const rel = path.relative(path.resolve(base), path.resolve(dir))
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return true
  const [a, b] = await Promise.all([gitDir(base), gitDir(dir)])
  return !!a && a === b
}

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
  if (method === 'tools/list') return void json({ result: { tools: [...TOOLS, ...CANVAS_TOOLS] } })
  if (method !== 'tools/call') return void json({ error: { code: -32601, message: `Method not found: ${method}` } })

  const args = (params.arguments ?? {}) as { session?: string; message?: string }
  if (params.name === 'list_sessions') return void json(text(listSessions(nodeId)))
  if (CANVAS_TOOL_NAMES.has(String(params.name))) {
    canvasTool(nodeId, String(params.name), args).then(([t, isError]) => json(text(t, isError)))
    return
  }
  if (params.name !== 'ask_session' && params.name !== 'send_message')
    return void json({ error: { code: -32602, message: `Unknown tool: ${params.name}` } })

  const target = peer(nodeId, String(args.session ?? ''))
  if (typeof target === 'string') return void json(text(target, true))
  const message = String(args.message ?? '').trim()
  if (!message) return void json(text('Mensagem vazia.', true))

  if (params.name === 'send_message') {
    whenReady(target.id).then((isReady) => {
      const ok = isReady && deliver(target.id, `[${MESSAGE_TAG}] Aviso da sessão "${name(nodeId)}" (ela não espera resposta).\n\n${message}`)
      json(text(ok ? `Entregue a "${target.title}".` : `A sessão "${target.title}" não está pronta ou não está rodando.`, !ok))
    })
    return
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
