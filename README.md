# Helm

> Live dashboard for every coding agent on your machine.

Helm is a native desktop dashboard that auto-discovers and renders sessions from your coding agents — Claude Code today, Codex / Aider / Cline next — in one polished, real-time view. Local-first, MIT-licensed, no setup.

## Status

Pre-alpha. v0.2 in flight — Claude Code only, more adapters in v0.3.

## What's new in v0.2

- **Native OS notifications** for sessions that need you. Single `mode` setting (`off` /
  `blocked-only` (default) / `blocked-and-finished`) — preferences UI lands in v0.3, configurable
  via DevTools for now: `window.helm.invoke('settings:set', { notifications: { mode: 'blocked-and-finished' } })`.
  Click a notification to jump straight to that session's detail view.
- **Cost rollup strip** above the multi-session grid: today / this week / this month, broken down
  by cloud vs local model class. Local sessions are always $0.
- **Refresh button** in the sessions header, plus automatic re-discovery on app focus
  (throttled to 5s) — new sessions started while Helm was in the background show up without
  manually rescanning.
- **Granular discovery messages**: tells you when a tool is installed but has no sessions yet
  ("Run claude in any project to get started") vs when it isn't installed at all, vs when it's
  there but unreadable due to permissions.
- **Eviction**: sessions deleted from disk are evicted from in-memory state on the next list
  refresh — long-running Helm processes no longer accumulate dead-session metadata.
- **Audit cleanup**: model swaps mid-session now display the latest model in the detail
  view stats strip (was previously stuck on the first model used).

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
