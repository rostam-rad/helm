/**
 * Tail a Claude Code session file, parse new lines as they arrive,
 * and emit Message records to a callback.
 *
 * Implementation notes:
 *  - chokidar watches a single file. On 'change', we read from the last
 *    known byte offset to the current EOF. We never re-read from the start.
 *  - The tail of a JSONL file may be a partial line if Claude Code is
 *    writing as we read. We hold any partial trailing fragment over to
 *    the next read and prepend it.
 *  - We parse line-by-line. parseLine() never throws on bad input, so
 *    a half-written JSON object just produces no messages until the next
 *    write completes the line.
 */

import * as fs from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';
import type { Message } from '../../../shared/types';
import { parseLine } from './parser';

export function watchSessionFile(filePath: string, onMessage: (m: Message) => void): () => void {
  let offset = 0;
  let buffer = '';
  let watcher: FSWatcher | null = null;

  // Seek to current end on start — we only emit *new* messages, not history.
  // (History is loaded separately via parseSession.)
  try {
    offset = fs.statSync(filePath).size;
  } catch {
    offset = 0;
  }

  const readNew = () => {
    let stat;
    try { stat = fs.statSync(filePath); } catch { return; }

    // File was truncated or replaced — start over from the new size.
    if (stat.size < offset) {
      offset = 0;
      buffer = '';
    }
    if (stat.size === offset) return;

    const stream = fs.createReadStream(filePath, {
      start: offset,
      end: stat.size - 1,
      encoding: 'utf-8',
    });
    let chunk = '';
    stream.on('data', (data) => { chunk += data; });
    stream.on('end', () => {
      offset = stat.size;
      buffer += chunk;
      const lines = buffer.split('\n');
      // Last element is either '' (clean newline) or a partial line.
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        for (const msg of parseLine(line)) onMessage(msg);
      }
    });
    stream.on('error', () => { /* swallowed; next change event will retry */ });
  };

  watcher = chokidar.watch(filePath, {
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
  });
  watcher.on('change', readNew);

  return () => {
    watcher?.close();
    watcher = null;
  };
}
