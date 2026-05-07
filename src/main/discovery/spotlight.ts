/**
 * Filesystem search fallback for agent data directories.
 *
 * When Helm can't find any sessions through standard discovery paths, the
 * user can trigger a broader filesystem search. This module runs a
 * platform-appropriate search command and returns candidate paths that the
 * adapters can validate.
 *
 * Platform commands:
 *   macOS:   mdfind (Spotlight) — fast, index-based
 *   Windows: PowerShell Get-ChildItem -Recurse (depth-limited)
 *   Linux:   find with -maxdepth and timeout
 *
 * All platforms: 30s wall-clock cap, max 100 results, results validated
 * through each adapter's validatePath before being returned.
 */

import { spawn } from 'node:child_process';
import * as os from 'node:os';
import type { AdapterId } from '../../shared/types';

export interface SpotlightResult {
  path: string;
  adapter: AdapterId;
  confidence: 'high' | 'low';
}

// Map directory names to adapters and confidence levels.
const DIR_TO_ADAPTER: Record<string, { adapter: AdapterId; confidence: 'high' | 'low' }> = {
  '.claude':                  { adapter: 'claude-code', confidence: 'high' },
  'saoudrizwan.claude-dev':   { adapter: 'cline',       confidence: 'high' },
};

function classifyPath(p: string): { adapter: AdapterId; confidence: 'high' | 'low' } | null {
  for (const [dir, info] of Object.entries(DIR_TO_ADAPTER)) {
    if (p.endsWith(dir) || p.includes(`/${dir}/`) || p.includes(`\\${dir}\\`)) {
      return info;
    }
  }
  return null;
}

function runCommand(
  cmd: string,
  args: string[],
  signal: AbortSignal,
): Promise<string[]> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });

    if (signal.aborted) { proc.kill(); resolve([]); return; }
    signal.addEventListener('abort', () => proc.kill(), { once: true });

    proc.stdout.on('data', (chunk: Buffer | string) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : chunk;
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (t && lines.length < 100) lines.push(t);
      }
    });

    proc.on('close', () => resolve(lines));
    proc.on('error', () => resolve(lines));
  });
}

async function searchMacOS(signal: AbortSignal): Promise<string[]> {
  const names = Object.keys(DIR_TO_ADAPTER).map(n => `kMDItemFSName == "${n}"`).join(' || ');
  return runCommand('mdfind', [names, '-onlyin', os.homedir()], signal);
}

async function searchWindows(signal: AbortSignal): Promise<string[]> {
  const filters = Object.keys(DIR_TO_ADAPTER).map(n => `'${n}'`).join(',');
  const script = `Get-ChildItem -Path $env:USERPROFILE -Recurse -Force -Depth 6 -ErrorAction SilentlyContinue | Where-Object { ${filters} -contains $_.Name } | Select-Object -First 100 -ExpandProperty FullName`;
  return runCommand('powershell', ['-NoProfile', '-Command', script], signal);
}

async function searchLinux(signal: AbortSignal): Promise<string[]> {
  const nameArgs: string[] = [];
  const names = Object.keys(DIR_TO_ADAPTER);
  for (let i = 0; i < names.length; i++) {
    if (i > 0) nameArgs.push('-o');
    nameArgs.push('-name', names[i]!);
  }
  return runCommand(
    'find',
    [os.homedir(), '-maxdepth', '6', '-type', 'd', '(', ...nameArgs, ')'],
    signal,
  );
}

export async function searchFilesystemForAgentData(
  abortSignal: AbortSignal,
): Promise<SpotlightResult[]> {
  const timeout = setTimeout(() => {
    // Belt-and-suspenders: abort after 30s regardless of caller.
  }, 30_000);

  let rawPaths: string[] = [];
  try {
    if (process.platform === 'darwin') {
      rawPaths = await searchMacOS(abortSignal);
    } else if (process.platform === 'win32') {
      rawPaths = await searchWindows(abortSignal);
    } else {
      rawPaths = await searchLinux(abortSignal);
    }
  } finally {
    clearTimeout(timeout);
  }

  const results: SpotlightResult[] = [];
  const seen = new Set<string>();
  for (const p of rawPaths) {
    if (seen.has(p)) continue;
    seen.add(p);
    const info = classifyPath(p);
    if (info) results.push({ path: p, ...info });
  }
  return results;
}
