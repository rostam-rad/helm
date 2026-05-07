# Helm

> Live dashboard for every coding agent on your machine.

Helm is a native desktop dashboard that auto-discovers and renders sessions from your coding agents — Claude Code and Cline today, more adapters coming — in one polished, real-time view. Local-first, MIT-licensed, no setup.

## Status

Pre-alpha. v0.3 shipping — Claude Code + Cline, more adapters in v0.4.

## What's new in v0.3

- **Cline adapter**: Helm now auto-discovers and renders sessions from [Cline](https://github.com/cline/cline) (VS Code extension). Reads from `saoudrizwan.claude-dev` global storage across VS Code, Cursor, VSCodium, and Code-Insiders.
- **Settings UI**: gear icon in the top-right opens a full settings screen — theme, notification mode, per-adapter toggles, custom discovery paths, and cache controls. No DevTools required.
- **Notification permission onboarding**: if notifications are enabled but system permission is blocked, a banner guides you to the right OS settings page.
- **Filesystem search fallback**: "Search my computer" on the discovery screen uses Spotlight (macOS), PowerShell (Windows), or `find` (Linux) to locate agent data directories anywhere on your machine.
- **Auto-updater**: Helm checks for new releases on launch and every 4 hours (requires a signed build; dev builds skip this).
- **Interrupted sessions**: sessions interrupted mid-run (`[Request interrupted by user]`) now immediately show as awaiting-user instead of staying stuck on "working."

## What's new in v0.2

- **Native OS notifications** for sessions that need you — `off` / `blocked-only` (default) / `blocked-and-finished`. Click a notification to jump straight to that session's detail view.
- **Cost rollup strip** above the multi-session grid: today / this week / this month, broken down by cloud vs local model class. Local sessions are always $0.
- **Refresh button** in the sessions header, plus automatic re-discovery on app focus (throttled to 5s).
- **Granular discovery messages**: tells you when a tool is installed but has no sessions yet vs when it isn't installed at all vs when it's there but unreadable due to permissions.
- **Eviction**: sessions deleted from disk are evicted from in-memory state on the next list refresh.
- **Audit cleanup**: model swaps mid-session now display the latest model in the detail view stats strip.

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

Tests cover the parser, adapter lister/parser, state tracker, discovery, notifications, and Spotlight search. Run `npm run typecheck` for a full TypeScript check across both main and renderer.

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

## Notifications

Helm fires native OS notifications when a session needs attention. Three modes (configurable in Settings):

| Mode | Fires when |
|------|-----------|
| `off` | Never |
| `blocked-only` (default) | Agent is waiting for your input or a tool-use approval |
| `blocked-and-finished` | Also fires when a session completes |

### Enabling notifications per OS

**macOS** — System Settings → Notifications → Helm → Allow Notifications.

**Windows** — Settings → System → Notifications → Helm → On.

**Linux** — Helm uses `libnotify`; ensure a notification daemon (e.g. `dunst`, `mako`, or your DE's built-in) is running.

If Helm detects that notifications are blocked, a banner appears on the discovery screen with a direct link to the relevant settings page. See [docs/notifications.md](docs/notifications.md) for more detail.

## Adding a new adapter

Implement `AgentAdapter` in `src/main/adapters/<name>/`, then register it in `src/main/adapters/index.ts`. Discovery, listing, watching, and the UI pick it up automatically.
