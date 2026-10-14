export type Settings = {
  terminalCwd: string
  workspaceCwd: string
  shell: string
  showMinimap: boolean
  showControls: boolean
  rightDragPan: boolean
  /** Attach the app's MCP server to Claude sessions so connected ones can talk to each other. */
  agentMcp: boolean
  /** Replaces DEFAULT_AGENT_INSTRUCTIONS when non-empty. */
  agentInstructions: string
  /** Text box under the selected terminal/session for writing prompts (Enter sends). */
  composer: boolean
  /** A workspace moved to the trash is deleted for good after this many days. */
  trashDays: number
}

export const DEFAULT_SETTINGS: Settings = {
  terminalCwd: '',
  workspaceCwd: '',
  shell: '',
  showMinimap: true,
  showControls: true,
  rightDragPan: true,
  agentMcp: true,
  agentInstructions: '',
  trashDays: 7,
  composer: true
}

/** Marks a prompt as coming from another session; the hook handler matches replies by it. */
export const MESSAGE_TAG = 'fw-msg'

/**
 * Sent to every Claude session as the MCP server's instructions (it lands in the system
 * prompt at session start). Editable in Settings; each node's name and role are appended.
 */
export const DEFAULT_AGENT_INSTRUCTIONS = `Você roda dentro do Free Workspace, um canvas onde várias sessões de IA trabalham lado a lado. As ferramentas deste servidor permitem falar com as sessões que o usuário conectou a você no canvas.

- Use list_sessions para ver com quem você pode falar e o papel de cada uma.
- Use ask_session quando precisar da resposta (espera a outra sessão terminar o turno) e send_message quando for só um aviso.
- Escreva mensagens autossuficientes: a outra sessão não vê a sua conversa.
- Uma mensagem que começa com "[${MESSAGE_TAG}" veio de outra sessão, não do usuário. Se ela pede resposta, o texto final do seu turno é devolvido a quem perguntou: termine com a resposta completa.
- Não delegue o que você resolve rápido sozinho, e não peça a outra sessão para editar arquivos que você está editando.
- Para mostrar algo ao usuário, use open_file, create_note, create_todo ou open_terminal: aparece no canvas ao lado desta sessão. Use quando ajudar o usuário a acompanhar (um arquivo para revisar, um plano, uma lista de tarefas, um servidor rodando), não para cada passo.`
