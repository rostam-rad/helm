/**
 * Discovery for Claude Code data directories.
 *
 * Order of probes (first hit that validates wins, but we return all valid
 * hits so the user can pick if there are multiple):
 *
 *   1. CLAUDE_CONFIG_DIR env var
 *   2. ~/.claude/ on macOS/Linux, %USERPROFILE%\.claude\ on Windows
 *   3. $XDG_CONFIG_HOME/claude/ on Linux if XDG_CONFIG_HOME is set
 *
 * Each candidate is validated by the adapter's validatePath() before
 * being returned. We don't probe the filesystem from here — that's the
 * adapter's job. We just produce candidate paths.
 */

import * as path from 'node:path';
import * as os from 'node:os';

export function discoverClaudeCodePaths(): string[] {
  const candidates: string[] = [];

  // 1. Explicit override.
  const envOverride = process.env['CLAUDE_CONFIG_DIR'];
  if (envOverride) candidates.push(envOverride);

  // 2. Standard home-relative path. Same on every OS at this point —
  //    Node's os.homedir() returns the right thing on Windows too.
  candidates.push(path.join(os.homedir(), '.claude'));

  // 3. XDG fallback (Linux convention; some users set this).
  const xdg = process.env['XDG_CONFIG_HOME'];
  if (xdg) candidates.push(path.join(xdg, 'claude'));

  // De-dupe while preserving order.
  return Array.from(new Set(candidates));
}
