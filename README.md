# Free Workspace

An infinite canvas for development work. Terminals, AI coding sessions, code files, Markdown
notes, to-do lists and screenshots live side by side on one board per project, so the context
of a task stays in one place instead of spread across a terminal app, an editor, a notes app
and a screenshot tool.

<!-- IMAGE: hero screenshot. A real workspace with 2–3 terminals/AI sessions, a file open in
     the editor, a note and a pasted screenshot, sidebar visible with a colored group.
     Suggested path: docs/images/overview.png -->

> The interface is currently in Portuguese (pt-BR).

## Features

- **Canvas with everything in it** — real terminals, AI sessions, a code/Markdown editor with
  syntax highlighting, notes, to-do lists, a folder explorer, and screenshots pasted with
  Ctrl+V. Drag, resize, color and connect them freely.
- **AI sessions that pick up where they left off** — Claude Code sessions reopen the exact
  conversation they had, even with several sessions in the same folder, and show whether
  they're working or idle.
- **Sessions that talk to each other** — connect two sessions on the canvas and they can ask
  each other questions through a built-in MCP server (see below).
- **Git-aware** — each terminal shows its branch and whether it's a worktree; new terminals
  and sessions can start in a fresh worktree from any branch.
- **Workspaces** — one canvas per project, organized in colored, collapsible groups. They
  stay on stand-by until opened, and deleted ones go to a trash with scheduled removal.
- **Comfortable prompting** — a text box under the selected terminal for writing multi-line
  prompts (Shift+Enter for a new line).

<!-- IMAGE: two connected AI sessions, the link between them animated while one waits for
     the other's answer. Suggested path: docs/images/sessions.png -->

## MCP tools for AI sessions

Every Claude Code session started from the app is connected to an MCP server that runs inside
the app (localhost only, nothing to install). It gives the session these tools:

| Tool | What it does |
| --- | --- |
| `list_sessions` | Lists the sessions connected to this one on the canvas, with their role, status and folder. |
| `ask_session` | Sends a message to a connected session and waits for its answer. |
| `send_message` | Sends a message to a connected session without waiting. |
| `open_file` | Opens a file on the canvas, next to the session. |
| `create_note` | Creates a Markdown note on the canvas. |
| `create_todo` | Creates a to-do list on the canvas. |
| `open_terminal` | Opens a terminal on the canvas, optionally running a command. Asks for your confirmation first. |

Sessions only see the sessions you've connected to them by dragging a link between them. Each
session can have a role describing what it's for, and the instructions sent to all sessions
are editable in Settings.

<!-- IMAGE: a session that used create_note / create_todo, with the note and the list it
     created next to it. Suggested path: docs/images/canvas-tools.png -->

## Getting started

Requires Node.js 20+ and git. No C++ toolchain needed: node-pty ships prebuilt binaries for
Windows, macOS and Linux (x64 and arm64).

```bash
npm install
npm run dev
```

## Building the app

```bash
npm run dist
```

Builds the installers for the OS you run it on into `dist/`: an installer and a portable
`.exe` on Windows, a `.dmg` on macOS, an `.AppImage` and a `.deb` on Linux. The app isn't
code-signed, so Windows SmartScreen and macOS Gatekeeper warn on first launch.

Data is stored in `~/.free-workspace/`.

## Tests

```bash
npm run test:e2e
```

Launches the real app in a temporary workspace and drives it with real mouse and keyboard
events. Set `FW_E2E_REAL=1` to also run a step with the real Claude Code CLI as MCP client
(uses a few tokens), or `FW_E2E_EXE="<path to the .exe>"` to test a packaged build.

## Built with

Electron, React, [React Flow](https://reactflow.dev), xterm.js + node-pty, CodeMirror 6.

## Contributing

Issues and pull requests are welcome. Please run `npm run typecheck` and `npm run test:e2e`
before opening a PR.

## License

[MIT](LICENSE) © Francis Rotilli
