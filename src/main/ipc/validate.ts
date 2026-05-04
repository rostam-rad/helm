/**
 * Runtime payload validators for IPC handlers.
 *
 * TypeScript types vanish at runtime, and the renderer is — from the
 * main process's perspective — an untrusted boundary. Every payload
 * must be validated before being acted on. These helpers throw a
 * TypeError with a useful message on bad input; the caller should
 * not catch — invoke()'s reject path is the right behavior.
 */

export function assertString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

export function assertObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Session IDs in our system are UUIDs (Claude Code), Cline IDs
 * (timestamp-based), or similarly safe slug-shaped tokens. Reject
 * anything that could be interpreted as a path. Defense in depth —
 * sessionIndex.get(id) is currently the only consumer, but a future
 * refactor that constructs a path from id must not be exploitable.
 */
export function assertSessionId(value: unknown): string {
  const s = assertString(value, 'sessionId');
  if (!/^[A-Za-z0-9._-]+$/.test(s)) {
    throw new TypeError(`sessionId contains invalid characters`);
  }
  return s;
}
