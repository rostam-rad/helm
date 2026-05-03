/**
 * The AgentAdapter interface.
 *
 * This is the single extension point for supporting a new agent tool.
 * To add Codex / Aider / Cline / anything else: implement this interface,
 * register the instance in src/main/adapters/index.ts, and the rest of the
 * app picks it up automatically — discovery, listing, watching, and the
 * UI all work without code changes elsewhere.
 *
 * Keep this interface small. Adding methods here means every adapter has
 * to implement them. Anything optional or per-tool should live as helpers
 * inside the adapter, not on this contract.
 */

import type { SessionMeta, AdapterId, ValidationResult, Message } from '../../../shared/types';

export interface AgentAdapter {
  readonly id: AdapterId;
  readonly displayName: string;

  /** Candidate data directories to probe, ordered by preference. */
  discoverPaths(): Promise<string[]>;

  /** Validate that a candidate path actually contains this adapter's data. */
  validatePath(path: string): Promise<ValidationResult>;

  /** Cheap listing: enumerate sessions without parsing their full content. */
  listSessions(rootPath: string): Promise<SessionMeta[]>;

  /** Stream every message in a session, in order. */
  parseSession(filePath: string): AsyncIterable<Message>;

  /** Tail an active session. Returns an unsubscribe function. */
  watchSession(filePath: string, onMessage: (m: Message) => void): () => void;
}
