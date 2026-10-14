# Free Workspace

Canvas infinito para desenvolvimento: terminais, sessões de IA, arquivos de código, notas em
Markdown, ToDos e screenshots como elementos livres num mural, um mural por projeto.

## Rodar

Precisa de Node.js 20+ e git. Não precisa de compilador C++: o node-pty vem com binários
prontos para Windows, macOS e Linux (x64 e arm64).

```bash
npm install
npm run dev
```

## Gerar o executável

```bash
npm run dist
```

Gera em `dist/` os formatos do sistema em que você rodou o comando (cada sistema empacota o
próprio; não dá para gerar o de macOS a partir do Windows):

- **Windows**: `Free Workspace Setup <versão>.exe` (instalador, deixa escolher a pasta) e
  `Free Workspace-<versão>-portable.exe` (roda sem instalar).
- **macOS**: `.dmg`. **Linux**: `.AppImage` e `.deb`.

`npm run dist:dir` só monta a pasta descompactada (`dist/win-unpacked/`), mais rápido para
testar. O app não é assinado: no Windows o SmartScreen avisa na primeira execução (*Mais
informações → Executar assim mesmo*); no macOS, clique direito → *Abrir*.

Para validar um build: `FW_E2E_EXE="<caminho do .exe>" node test/run-e2e.mjs` roda os
testes e2e contra o app empacotado.

## Como usar

- Os workspaces abrem em **stand-by**: nada carrega (nenhum terminal sobe) até você clicar
  nele na lista. Os abertos ficam com o ponto verde e continuam rodando em segundo plano.
  Para voltar ao stand-by: clique direito no workspace → *Colocar em stand-by* (isso encerra
  os terminais dele).
- **Terminal / Sessão IA**: diretório + comando inicial opcional. O cabeçalho mostra a branch
  do diretório (e se é uma worktree).
- **Sessão Claude Code**: ao reabrir (app reiniciado ou workspace saindo do stand-by) volta na
  última conversa usada naquele terminal, mesmo com várias sessões na mesma pasta ou depois
  de um `/clear`. O ponto ao lado do ícone indica trabalhando (âmbar) ou ociosa (verde). Para
  outros agentes, escolha "Outro" e informe o comando de retomada.
- **Conversa entre sessões**: arraste do ponto na lateral de uma sessão Claude até o de outra
  para conectá-las (selecione a linha e `Del` para desfazer). Sessões conectadas ganham as
  ferramentas `list_sessions`, `ask_session` e `send_message` por um servidor MCP embutido no
  app; a linha fica animada enquanto uma espera a outra. Clique direito → *Papel da sessão…*
  descreve o que cada uma faz, e o texto geral de instruções é editável nas Configurações.
  Mudanças de papel/instruções valem para sessões iniciadas ou reiniciadas depois.
- **Sessão mostrando coisas no canvas**: as sessões Claude também têm `open_file`,
  `create_note`, `create_todo` e `open_terminal`, que abrem o item ao lado da própria sessão.
  As três primeiras rodam direto; `open_terminal` executa um comando, então o Claude Code pede
  sua confirmação antes, como faria com o próprio Bash.
- **Worktree**: marque "Abrir numa worktree git nova" ao criar um terminal/sessão para criar
  `<repo>.worktrees/<branch>` e já abrir lá. Remover worktrees é pelo terminal.
- **Ctrl+C** no terminal copia quando há seleção (senão interrompe o processo); **Ctrl+V** cola.
- **Ctrl+V** com imagem na área de transferência cola o print no canvas.
- **Explorador** (barra de cima ou clique direito no canvas): uma árvore de pastas no canvas.
  Clique num arquivo para abri-lo ao lado (se já estiver no canvas, ele é focado); clique
  direito numa pasta abre terminal ou sessão de IA nela. O filtro procura nas pastas já abertas.
- **Arrastar arquivos** do Explorer: imagem vira print, qualquer outro abre no editor (Ctrl+S salva).
- **Clique direito** num elemento: renomear, duplicar, copiar/colar/reiniciar terminal, abrir
  arquivo no VS Code etc. No canvas vazio: criar um elemento naquele ponto.
- **Caixa de texto**: com um terminal ou sessão selecionado, aparece uma caixa abaixo dele para
  escrever com calma: Enter envia, Shift+Enter quebra linha, ↑ com a caixa vazia recupera o
  que foi enviado, Esc volta ao terminal. Desligável nas Configurações.
- **Duplo clique no título** renomeia o elemento; num arquivo, renomeia o arquivo no disco.
- Arrastar o fundo (botão esquerdo, ou direito se ligado nas configurações) move o canvas. O
  zoom atual aparece no canto superior direito; clique nele para voltar a 100%.
- **Configurações** (rodapé da sidebar): diretório inicial e shell dos terminais, arrastar com
  o botão direito, minimapa e controles. Cada workspace pode ter seu próprio diretório padrão
  (clique direito no workspace).
- **Excluir workspace** (clique direito → *Excluir…*): *Mover para a lixeira* tira da lista e
  apaga de vez depois do prazo das Configurações (padrão 7 dias, verificado ao abrir o app);
  *Excluir agora* apaga na hora. Só o canvas do workspace é apagado (notas, ToDos, prints,
  posições); arquivos e repositórios abertos nele não são tocados. *Stand-by* não apaga nada.

Os dados ficam em `~/.free-workspace/` (`settings.json` e `workspaces/<id>/` com `canvas.json`
e `assets/`). Remover um terminal do canvas encerra o processo dele.

## Testes

```bash
npm run test:e2e
```

Abre o app de verdade num workspace temporário e o controla com eventos reais de mouse e
teclado (`test/e2e.cjs`): stand-by, zoom, seleção + Ctrl+C com zoom em 50%, colar, menus,
renomear, arrastar com o botão direito, configurações, retomada de sessão e conversa entre sessões via MCP (hooks simulados),
branch no cabeçalho, criação de worktree, troca de workspace, terminal crescendo sem
duplicar linhas, explorador, lixeira, caixa de texto e as ferramentas que abrem itens no canvas. `FW_E2E_REAL=1 npm run test:e2e` inclui um passo com o
Claude Code real como cliente MCP (gasta alguns tokens).

## Stack

Electron + React + [React Flow](https://reactflow.dev) (canvas) + xterm.js/node-pty (terminais) +
CodeMirror 6 (editor).

## Contribuindo

Issues e pull requests são bem-vindos. Antes de abrir um PR, rode `npm run typecheck` e
`npm run test:e2e`.

## Licença

[MIT](LICENSE) © Francis Rotilli
