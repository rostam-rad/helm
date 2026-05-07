import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useThemeStore, type ThemeMode } from '../stores/useThemeStore';
import { useNotificationPermissionStore } from '../stores/useNotificationPermissionStore';
import type { NotificationMode } from '@shared/ipc-contract';
import type { AdapterId } from '@shared/types';

export function SettingsView() {
  return (
    <div className="h-full overflow-y-auto bg-bg px-6 py-6">
      <h1 className="mb-6 text-[13px] font-semibold tracking-head text-fg">Settings</h1>
      <div className="mx-auto max-w-xl space-y-8">
        <AppearanceSection />
        <NotificationsSection />
        <AgentsSection />
        <DiscoveryPathsSection />
        <CacheSection />
      </div>
    </div>
  );
}

// ─── Section wrapper ────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 font-mono text-2xs tracking-caps text-fg-4 border-b border-rule pb-1">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="pt-0.5 text-[12.5px] text-fg-2">{label}</span>
      <div className="flex flex-col items-end gap-1">{children}</div>
    </div>
  );
}

// ─── Radio group ─────────────────────────────────────────────────────────────

function RadioGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-3">
      {options.map(o => (
        <label
          key={o.value}
          className={clsx(
            'flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 font-mono text-2xs tracking-caps transition-colors',
            value === o.value
              ? 'border-accent text-accent bg-accent/10'
              : 'border-rule text-fg-3 hover:text-fg hover:border-fg-3',
          )}
        >
          <input
            type="radio"
            className="sr-only"
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

// ─── Appearance ──────────────────────────────────────────────────────────────

function AppearanceSection() {
  const { mode, setMode } = useThemeStore();

  return (
    <Section title="Appearance">
      <Row label="Theme">
        <RadioGroup<ThemeMode>
          value={mode}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark',  label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
          onChange={setMode}
        />
      </Row>
    </Section>
  );
}

// ─── Notifications ───────────────────────────────────────────────────────────

function NotificationsSection() {
  const { settings, update } = useSettingsStore();
  const { status, load } = useNotificationPermissionStore();
  const mode = settings?.notifications.mode ?? 'blocked-only';

  useEffect(() => { void load(); }, [load]);

  function setMode(m: NotificationMode) {
    const checkForUpdates = settings?.notifications.checkForUpdates ?? true;
    void update({ notifications: { mode: m, checkForUpdates } });
  }

  return (
    <Section title="Notifications">
      <Row label="Mode">
        <RadioGroup<NotificationMode>
          value={mode}
          options={[
            { value: 'off',                label: 'Off' },
            { value: 'blocked-only',       label: 'Blocked only' },
            { value: 'blocked-and-finished', label: 'All' },
          ]}
          onChange={setMode}
        />
      </Row>
      <Row label="System permission">
        <PermissionStatusBadge status={status} />
      </Row>
    </Section>
  );
}

function PermissionStatusBadge({ status }: { status: string | null }) {
  if (status === null) return <span className="font-mono text-2xs tracking-caps text-fg-4">—</span>;
  if (status === 'granted') {
    return (
      <span className="font-mono text-2xs tracking-caps text-live">✓ Enabled</span>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-2xs tracking-caps text-error">
        {status === 'denied' ? '✕ Blocked' : '? Unknown'}
      </span>
      <button
        onClick={() => void window.helm?.invoke('notifications:open-system-settings')}
        className="rounded border border-rule bg-bg-2 px-2 py-0.5 font-mono text-2xs tracking-caps text-fg hover:bg-bg-3 transition-colors"
      >
        Open settings
      </button>
    </div>
  );
}

// ─── Agents ──────────────────────────────────────────────────────────────────

type AdapterInfo = { id: AdapterId; displayName: string; enabled: boolean };

function AgentsSection() {
  const { settings, update } = useSettingsStore();
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);

  useEffect(() => {
    if (!window.helm) return;
    void window.helm.invoke('adapters:list').then(setAdapters);
  }, []);

  function toggleAdapter(id: AdapterId, enabled: boolean) {
    const current = settings?.enabledAdapters ?? [];
    const next = enabled
      ? [...current, id]
      : current.filter(a => a !== id);
    void update({ enabledAdapters: next });
  }

  return (
    <Section title="Agents">
      {adapters.length === 0 && (
        <p className="font-mono text-2xs tracking-caps text-fg-4">No adapters registered.</p>
      )}
      {adapters.map(a => (
        <Row key={a.id} label={a.displayName}>
          <Toggle
            checked={a.enabled}
            onChange={v => toggleAdapter(a.id, v)}
          />
        </Row>
      ))}
    </Section>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
        'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
        checked ? 'bg-accent' : 'bg-fg-4/40',
      )}
    >
      <span
        className={clsx(
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
}

// ─── Discovery paths ─────────────────────────────────────────────────────────

function DiscoveryPathsSection() {
  const { settings, update } = useSettingsStore();
  const customPaths = settings?.customPaths ?? [];

  async function addPath() {
    if (!window.helm) return;
    const dir = await window.helm.invoke('dialog:open-directory');
    if (!dir) return;
    // Default to claude-code adapter; user can change later via remove+re-add
    const next = [...customPaths, { adapter: 'claude-code' as AdapterId, path: dir }];
    void update({ customPaths: next });
  }

  function removePath(path: string) {
    void update({ customPaths: customPaths.filter(p => p.path !== path) });
  }

  return (
    <Section title="Discovery Paths">
      {customPaths.length === 0 && (
        <p className="font-mono text-2xs tracking-caps text-fg-4">
          No custom paths. Helm auto-discovers standard locations.
        </p>
      )}
      {customPaths.map(p => (
        <div key={p.path} className="flex items-center justify-between gap-3 rounded border border-rule bg-bg-2 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate font-mono text-2xs text-fg">{p.path}</p>
            <p className="font-mono text-2xs tracking-caps text-fg-4">{p.adapter}</p>
          </div>
          <button
            onClick={() => removePath(p.path)}
            className="shrink-0 font-mono text-2xs tracking-caps text-fg-4 hover:text-error transition-colors"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        onClick={() => void addPath()}
        className="mt-1 rounded border border-rule bg-bg-2 px-3 py-1.5 font-mono text-2xs tracking-caps text-fg hover:bg-bg-3 transition-colors"
      >
        + Add custom path
      </button>
    </Section>
  );
}

// ─── Cache ───────────────────────────────────────────────────────────────────

function CacheSection() {
  const [cleared, setCleared] = useState(false);

  async function clearCache() {
    if (!window.helm) return;
    // Re-run discovery to flush in-memory state.
    await window.helm.invoke('sessions:list');
    setCleared(true);
    setTimeout(() => setCleared(false), 2000);
  }

  return (
    <Section title="Cache">
      <Row label="In-memory session cache">
        <button
          onClick={() => void clearCache()}
          className="rounded border border-rule bg-bg-2 px-3 py-1 font-mono text-2xs tracking-caps text-fg hover:bg-bg-3 transition-colors"
        >
          {cleared ? '✓ Cleared' : 'Clear cache'}
        </button>
      </Row>
    </Section>
  );
}
