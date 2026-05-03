# Helm

> Live dashboard for every coding agent on your machine.

Helm is a native desktop dashboard that auto-discovers and renders sessions from your coding agents — Claude Code today, Codex / Aider / Cline next — in one polished, real-time view. Local-first, MIT-licensed, no setup.

## Status

Pre-alpha. v0.1 ships Claude Code support only.

## Develop

```bash
npm install
npm run dev
```

This starts the Vite dev server for the renderer and Electron pointed at it.

## Test

```bash
npm test
```

The parser is the load-bearing piece of v0.1; tests live in `tests/unit/parser.test.ts`.

## Project layout

```
src/
├── main/                 # Electron main process (Node)
│   ├── adapters/         # one folder per agent tool
│   ├── discovery/        # session-data location auto-detection
│   ├── ipc/              # typed IPC handlers
│   ├── store/            # settings persistence
│   └── config/           # central tables (model classification, defaults)
├── renderer/             # React UI
└── shared/               # types + IPC contract used by both sides
```

## Adding a new adapter

Implement `AgentAdapter` in `src/main/adapters/<name>/`, then register it in `src/main/adapters/index.ts`. Discovery, listing, watching, and the UI pick it up automatically.
