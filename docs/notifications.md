# Notifications

Helm fires native OS notifications when a coding-agent session needs attention. All notification delivery happens locally — no data leaves your machine.

## Modes

Open **Settings** (gear icon, top-right) and choose a notification mode under the Notifications section:

| Mode | Description |
|------|-------------|
| `off` | No notifications |
| `blocked-only` | Fires when an agent is awaiting your input or waiting for a tool-use approval (default) |
| `blocked-and-finished` | Also fires when a session completes |

Clicking a notification brings Helm to the foreground and opens that session's detail view.

## Enabling system permission

Helm requests notification permission the first time it needs to show one. If permission was previously denied, Helm displays a banner on the discovery and sessions screens with a direct link to your OS settings.

### macOS

1. Open **System Settings → Notifications**
2. Find **Helm** in the list
3. Set **Allow Notifications** to on
4. (Optional) Choose whether to allow banners, alerts, or badges

### Windows

1. Open **Settings → System → Notifications**
2. Find **Helm** under "Notifications from apps and other senders"
3. Toggle it on

### Linux

Helm uses the D-Bus `org.freedesktop.Notifications` interface (libnotify). Make sure a notification daemon is running:

- GNOME: built in
- KDE Plasma: built in
- i3 / sway: install `dunst` or `mako`
- Other: check your DE's docs

If no daemon is running, notifications are silently dropped. Helm does not surface a permission banner on Linux because there is no system permission API to query.

## Troubleshooting

**Notifications enabled but not appearing**

1. Check the system permission (Settings → Notifications section → "System permission" row shows the current status).
2. On macOS, make sure "Do Not Disturb" / Focus mode isn't active.
3. On Windows, check that "Quiet hours" is off.
4. Restart Helm after changing system permissions — Electron caches the permission state at startup.

**Getting too many notifications**

Switch from `blocked-and-finished` to `blocked-only`. This suppresses completion notifications while keeping the high-signal "agent needs you" ones.

**Getting no notifications for a specific session**

If a session was already in a blocked state when Helm launched, the initial seed won't fire a notification (Helm only notifies on *transitions*). Start a new session or wait for the agent to transition states.
