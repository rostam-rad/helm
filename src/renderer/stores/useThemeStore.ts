import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  resolved: Resolved;
  setMode: (mode: ThemeMode) => void;
}

const STORAGE_KEY = 'helm.theme';
const mql = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function readStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {}
  return 'system';
}

function resolve(mode: ThemeMode): Resolved {
  if (mode === 'system') return mql?.matches ? 'dark' : 'light';
  return mode;
}

function applyToDom(resolved: Resolved): void {
  document.documentElement.setAttribute('data-theme', resolved);
}

const initialMode = readStoredMode();
const initialResolved = resolve(initialMode);

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: initialMode,
  resolved: initialResolved,
  setMode(mode) {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
    const resolved = resolve(mode);
    applyToDom(resolved);
    set({ mode, resolved });
  },
}));

// Keep `system` mode in sync with the OS-level toggle.
if (mql) {
  const onChange = () => {
    if (useThemeStore.getState().mode !== 'system') return;
    const resolved: Resolved = mql.matches ? 'dark' : 'light';
    applyToDom(resolved);
    useThemeStore.setState({ resolved });
  };
  if ('addEventListener' in mql) mql.addEventListener('change', onChange);
  else (mql as MediaQueryList).addListener(onChange);
}
