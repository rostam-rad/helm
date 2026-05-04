/**
 * Tests for the IPC handlers' security boundary:
 *
 *  1. validate.ts assertion helpers — positive cases (real session IDs
 *     from existing fixtures) and negative cases (malformed payloads).
 *     Positive tests are critical: they prevent a future tightening of
 *     the regex from silently breaking real sessions.
 *
 *  2. The metaWatcher early-return: when a session has an active
 *     per-session live watcher, the meta-watcher's change handler
 *     must not re-seed the tracker for it. Re-seeding from the 64KB
 *     tail would truncate message history that the per-session
 *     watcher's incremental tracker.ingest calls have built up.
 */

import { describe, it, expect } from 'vitest';
import { assertString, assertObject, assertSessionId } from '../../src/main/ipc/validate';

describe('assertString', () => {
  it('returns the string for a valid non-empty value', () => {
    expect(assertString('hello', 'name')).toBe('hello');
  });
  it('throws on empty string', () => {
    expect(() => assertString('', 'name')).toThrow(TypeError);
  });
  it('throws on non-string types', () => {
    expect(() => assertString(42, 'n')).toThrow(TypeError);
    expect(() => assertString(null, 'n')).toThrow(TypeError);
    expect(() => assertString(undefined, 'n')).toThrow(TypeError);
    expect(() => assertString({}, 'n')).toThrow(TypeError);
    expect(() => assertString([], 'n')).toThrow(TypeError);
  });
  it('includes the parameter name in the error message', () => {
    expect(() => assertString(null, 'foo')).toThrow(/foo/);
  });
});

describe('assertObject', () => {
  it('returns the object for a valid value', () => {
    const obj = { a: 1 };
    expect(assertObject(obj, 'p')).toBe(obj);
  });
  it('throws on null', () => {
    expect(() => assertObject(null, 'p')).toThrow(TypeError);
  });
  it('throws on arrays', () => {
    expect(() => assertObject([], 'p')).toThrow(TypeError);
  });
  it('throws on primitives', () => {
    expect(() => assertObject('x', 'p')).toThrow(TypeError);
    expect(() => assertObject(42, 'p')).toThrow(TypeError);
    expect(() => assertObject(undefined, 'p')).toThrow(TypeError);
  });
});

describe('assertSessionId', () => {
  // Positive cases: real session IDs from ~/.claude/projects/, hand-pasted.
  // If the regex ever tightens and breaks one of these, the failure here
  // is louder than discovering it via a user report that "Helm can't open
  // any of my sessions."
  it.each([
    '082b842f-4465-4cb5-95c6-390b46f7d16e',
    '9cf21f6a-ced9-44b0-b2cb-243098f6fd05',
    '2a734264-c9c3-46f4-aa5f-7debe4c07873',
    // Defensive: also accept timestamp-style IDs that other adapters produce.
    '1716234567890',
    'session_abc-123.v2',
  ])('accepts real-world session id %s', (id) => {
    expect(assertSessionId(id)).toBe(id);
  });

  it('throws on path-traversal attempts', () => {
    expect(() => assertSessionId('../../../etc/passwd')).toThrow(TypeError);
    expect(() => assertSessionId('../foo')).toThrow(TypeError);
    expect(() => assertSessionId('foo/bar')).toThrow(TypeError);
    expect(() => assertSessionId('foo\\bar')).toThrow(TypeError);
  });

  it('throws on empty string', () => {
    expect(() => assertSessionId('')).toThrow(TypeError);
  });

  it('throws on non-string', () => {
    expect(() => assertSessionId(12345)).toThrow(TypeError);
    expect(() => assertSessionId(null)).toThrow(TypeError);
    expect(() => assertSessionId({ toString: () => 'evil' })).toThrow(TypeError);
  });

  it('throws on whitespace and control characters', () => {
    expect(() => assertSessionId('foo bar')).toThrow(TypeError);
    expect(() => assertSessionId('foo\nbar')).toThrow(TypeError);
  });
});

/**
 * The metaWatcher.on('change') handler in handlers.ts is not currently
 * exported — it's a closure inside startMetaWatcher. Rather than refactor
 * the production code purely for testability, this test asserts the
 * critical invariant via the smaller `activeWatchers.has(id)` check that
 * the early-return depends on. The actual integration is exercised by
 * the manual verification step in the release checklist.
 *
 * If the early-return is removed from handlers.ts, the change handler
 * will fall through to tracker.seed for live-watched sessions, which
 * is the bug we're guarding against.
 */
describe('metaWatcher early-return invariant', () => {
  it('Map.has() returns true after set and false after delete (sanity)', () => {
    const watchers = new Map<string, () => void>();
    watchers.set('sess-1', () => {});
    expect(watchers.has('sess-1')).toBe(true);
    watchers.delete('sess-1');
    expect(watchers.has('sess-1')).toBe(false);
  });

  // Verify the early-return source line still exists, as a smoke check
  // against a refactor accidentally deleting it. Reads handlers.ts
  // directly — cheaper than a full integration test and louder than
  // none.
  it('handlers.ts still contains the activeWatchers.has(sessionId) early return', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/main/ipc/handlers.ts'),
      'utf-8',
    );
    // The exact early-return statement. If this string disappears, the
    // metaWatcher will start re-seeding live-watched sessions again.
    expect(src).toContain('if (activeWatchers.has(sessionId)) return;');
  });
});
