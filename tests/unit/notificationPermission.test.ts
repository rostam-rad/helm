/**
 * Tests for notification permission detection and system settings deep-link.
 *
 * Mocks electron so we can control platform and systemPreferences behaviour
 * without a real OS notification subsystem.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockShellOpenExternal = vi.fn();
let mockAuthorizationStatus: number | undefined = 2;
let mockGetNotificationSettings: (() => { authorizationStatus: number }) | undefined;
let mockIsSupported = true;
let mockPlatform: NodeJS.Platform = 'darwin';

vi.mock('electron', () => ({
  shell: { openExternal: (...args: unknown[]) => mockShellOpenExternal(...args) },
  systemPreferences: {
    get getNotificationSettings() { return mockGetNotificationSettings; },
  },
  Notification: {
    get isSupported() { return () => mockIsSupported; },
  },
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// Patch process.platform via Object.defineProperty so we can vary it per test.
function setPlatform(p: NodeJS.Platform) {
  mockPlatform = p;
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

import { getNotificationPermissionStatus, openSystemNotificationSettings } from '../../src/main/notifications/permission';

beforeEach(() => {
  mockShellOpenExternal.mockClear();
  mockIsSupported = true;
  mockAuthorizationStatus = 2;
  mockGetNotificationSettings = () => ({ authorizationStatus: mockAuthorizationStatus ?? 2 });
  setPlatform('darwin');
});

// ── getNotificationPermissionStatus ──────────────────────────────────────────

describe('getNotificationPermissionStatus', () => {
  it('returns "denied" when Notification.isSupported() is false', async () => {
    mockIsSupported = false;
    expect(await getNotificationPermissionStatus()).toBe('denied');
  });

  it('macOS authorizationStatus=2 → granted', async () => {
    mockAuthorizationStatus = 2;
    expect(await getNotificationPermissionStatus()).toBe('granted');
  });

  it('macOS authorizationStatus=3 (provisional) → granted', async () => {
    mockAuthorizationStatus = 3;
    expect(await getNotificationPermissionStatus()).toBe('granted');
  });

  it('macOS authorizationStatus=4 (ephemeral) → granted', async () => {
    mockAuthorizationStatus = 4;
    expect(await getNotificationPermissionStatus()).toBe('granted');
  });

  it('macOS authorizationStatus=1 (denied) → denied', async () => {
    mockAuthorizationStatus = 1;
    expect(await getNotificationPermissionStatus()).toBe('denied');
  });

  it('macOS authorizationStatus=0 (notDetermined) → unknown', async () => {
    mockAuthorizationStatus = 0;
    expect(await getNotificationPermissionStatus()).toBe('unknown');
  });

  it('macOS getNotificationSettings unavailable → unknown', async () => {
    mockGetNotificationSettings = undefined;
    expect(await getNotificationPermissionStatus()).toBe('unknown');
  });

  it('windows → granted (isSupported sufficient)', async () => {
    setPlatform('win32');
    expect(await getNotificationPermissionStatus()).toBe('granted');
  });

  it('linux → granted (isSupported sufficient)', async () => {
    setPlatform('linux');
    expect(await getNotificationPermissionStatus()).toBe('granted');
  });
});

// ── openSystemNotificationSettings ───────────────────────────────────────────

describe('openSystemNotificationSettings', () => {
  it('macOS opens the apple.preference.notifications URL', () => {
    setPlatform('darwin');
    openSystemNotificationSettings();
    expect(mockShellOpenExternal).toHaveBeenCalledWith(
      expect.stringContaining('x-apple.systempreferences'),
    );
  });

  it('windows opens ms-settings:notifications', () => {
    setPlatform('win32');
    openSystemNotificationSettings();
    expect(mockShellOpenExternal).toHaveBeenCalledWith('ms-settings:notifications');
  });

  it('linux opens a docs URL', () => {
    setPlatform('linux');
    openSystemNotificationSettings();
    expect(mockShellOpenExternal).toHaveBeenCalledWith(expect.stringContaining('http'));
  });
});
