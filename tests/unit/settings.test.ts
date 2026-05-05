/**
 * Tests for settingsStore.update — the validation boundary for
 * renderer-supplied settings patches. Mocks electron-store so the test
 * doesn't need a real Electron app context.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock is hoisted above all `let`/`const` in the module body, so the
// backing store cannot be a top-level variable referenced from the
// factory directly. We attach it to globalThis instead — both the
// hoisted factory and the per-test reset see the same object.
declare global {
  // eslint-disable-next-line no-var
  var __settingsBacking: Record<string, unknown>;
}
globalThis.__settingsBacking = {};

vi.mock('electron-store', () => {
  function backing(): Record<string, unknown> {
    if (!globalThis.__settingsBacking) globalThis.__settingsBacking = {};
    return globalThis.__settingsBacking;
  }
  return {
    default: class MockStore {
      constructor(opts: { defaults: Record<string, unknown> }) {
        const b = backing();
        if (opts?.defaults) {
          for (const [k, v] of Object.entries(opts.defaults)) {
            if (!(k in b)) b[k] = v;
          }
        }
      }
      get(key: string) { return backing()[key]; }
      set(key: string, value: unknown) { backing()[key] = value; }
    },
  };
});

// Imported after the mock is registered.
import { settingsStore } from '../../src/main/store/settings';
import { DEFAULT_SETTINGS } from '../../src/shared/ipc-contract';

beforeEach(() => {
  globalThis.__settingsBacking = { settings: structuredClone(DEFAULT_SETTINGS) };
  settingsStore.__resetForTests();
});

describe('settingsStore.update', () => {
  it('updates theme when given a valid value', () => {
    const next = settingsStore.update({ theme: 'dark' });
    expect(next.theme).toBe('dark');
  });

  it('ignores invalid theme value', () => {
    const next = settingsStore.update({ theme: 'invalid' });
    expect(next.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it('ignores unknown keys', () => {
    const before = settingsStore.get();
    const next = settingsStore.update({ unknownKey: 'foo', anotherFakeKey: 42 });
    expect(next).toEqual(before);
    // Unknown keys must not appear on the persisted object.
    expect((next as unknown as Record<string, unknown>)['unknownKey']).toBeUndefined();
  });

  it('does not allow prototype pollution via __proto__', () => {
    // Use JSON.parse to construct an object with an actual __proto__ key
    // (object literal {__proto__: ...} is a setter, not an own property).
    const polluted = JSON.parse('{"__proto__": {"polluted": true}}');
    settingsStore.update(polluted);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect((Object.prototype as unknown as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('ignores non-array enabledAdapters', () => {
    const next = settingsStore.update({ enabledAdapters: 'not-an-array' });
    expect(next.enabledAdapters).toEqual(DEFAULT_SETTINGS.enabledAdapters);
  });

  it('ignores enabledAdapters entries that are not strings', () => {
    const next = settingsStore.update({ enabledAdapters: ['claude-code', 42, null] });
    // Whole array rejected when any entry is invalid.
    expect(next.enabledAdapters).toEqual(DEFAULT_SETTINGS.enabledAdapters);
  });

  it('filters invalid customPaths entries while keeping valid ones', () => {
    const next = settingsStore.update({
      customPaths: [
        { adapter: 'claude-code', path: '/tmp' },
        { invalid: true },
        { adapter: 'codex', path: 12345 },
        null,
        { adapter: 'aider', path: '/home/user/.aider' },
      ],
    });
    expect(next.customPaths).toEqual([
      { adapter: 'claude-code', path: '/tmp' },
      { adapter: 'aider', path: '/home/user/.aider' },
    ]);
  });

  it('updates notifications.mode when given a valid value', () => {
    const next = settingsStore.update({ notifications: { mode: 'off' } });
    expect(next.notifications.mode).toBe('off');
  });

  it('accepts blocked-and-finished mode', () => {
    const next = settingsStore.update({ notifications: { mode: 'blocked-and-finished' } });
    expect(next.notifications.mode).toBe('blocked-and-finished');
  });

  it('rejects invalid notification mode value, keeping current', () => {
    const next = settingsStore.update({ notifications: { mode: 'every-second' } });
    expect(next.notifications.mode).toBe(DEFAULT_SETTINGS.notifications.mode);
  });

  it('drops v0.1 notification keys (onIdle, onError, ...) and accepts mode in the same patch', () => {
    // This is the audit-required test: send a payload that mixes v0.1
    // keys with the new v0.2 shape and verify the result has only `mode`.
    const next = settingsStore.update({
      notifications: { onIdle: true, onError: false, idleThresholdSeconds: 120, mode: 'off' },
    } as unknown);
    expect(next.notifications).toEqual({ mode: 'off' });
    // Defense in depth: the v0.1 fields must not have leaked through.
    expect((next.notifications as unknown as Record<string, unknown>)['onIdle']).toBeUndefined();
    expect((next.notifications as unknown as Record<string, unknown>)['idleThresholdSeconds']).toBeUndefined();
  });

  it('throws TypeError on null payload', () => {
    expect(() => settingsStore.update(null)).toThrow(TypeError);
  });

  it('throws TypeError on string payload', () => {
    expect(() => settingsStore.update('hi')).toThrow(TypeError);
  });

  it('throws TypeError on array payload', () => {
    expect(() => settingsStore.update([])).toThrow(TypeError);
  });

  it('throws TypeError on number payload', () => {
    expect(() => settingsStore.update(42)).toThrow(TypeError);
  });
});

describe('settingsStore.get — v0.1 → v0.2 notifications migration', () => {
  it('migrates a v0.1 notifications shape to { mode: "blocked-only" }', () => {
    // Seed the backing store with the OLD shape (no `mode` key).
    globalThis.__settingsBacking = {
      settings: {
        ...structuredClone(DEFAULT_SETTINGS),
        notifications: {
          onIdle: true,
          onError: true,
          onComplete: false,
          idleThresholdSeconds: 600,
          // no mode
        },
      },
    };
    settingsStore.__resetForTests();
    const result = settingsStore.get();
    expect(result.notifications).toEqual({ mode: 'blocked-only' });
  });

  it('preserves a valid v0.2 mode when already migrated', () => {
    globalThis.__settingsBacking = {
      settings: {
        ...structuredClone(DEFAULT_SETTINGS),
        notifications: { mode: 'blocked-and-finished' },
      },
    };
    settingsStore.__resetForTests();
    const result = settingsStore.get();
    expect(result.notifications.mode).toBe('blocked-and-finished');
  });

  it('falls back to "blocked-only" if mode is invalid', () => {
    globalThis.__settingsBacking = {
      settings: {
        ...structuredClone(DEFAULT_SETTINGS),
        notifications: { mode: 'every-second' },
      },
    };
    settingsStore.__resetForTests();
    const result = settingsStore.get();
    expect(result.notifications.mode).toBe('blocked-only');
  });
});
