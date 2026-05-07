/**
 * Live watcher for Cline sessions.
 *
 * Watches api_conversation_history.json for changes using chokidar.
 * On change, re-reads and re-parses the whole file (it's a JSON array,
 * not a JSONL stream), diffs against a cached message count, and calls
 * the callback for each new message.
 */

import chokidar from 'chokidar';
import * as fs from 'node:fs';
import type { Message } from '../../../shared/types';
import { parseClineHistory } from './parser';

export function watchClineSession(
  filePath: string,
  onMessage: (m: Message) => void,
): () => void {
  let knownCount = 0;

  // Seed with current message count so we don't replay history on start.
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    knownCount = parseClineHistory(raw).length;
  } catch { /* file may not exist yet */ }

  const watcher = chokidar.watch(filePath, {
    persistent: true,
    ignoreInitial: true,
    usePolling: false,
  });

  watcher.on('change', () => {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const messages = parseClineHistory(raw);
      const newMessages = messages.slice(knownCount);
      knownCount = messages.length;
      for (const m of newMessages) onMessage(m);
    } catch { /* skip parse errors on partial writes */ }
  });

  return () => { void watcher.close(); };
}
