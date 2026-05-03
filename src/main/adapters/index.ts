/**
 * Adapter registry.
 *
 * Adding a new adapter is a one-line change here, plus the adapter's own
 * directory under src/main/adapters/. Nothing else in the app needs to
 * know which adapters exist.
 */

import type { AgentAdapter } from './types';
import type { AdapterId } from '../../shared/types';
import { claudeCodeAdapter } from './claude-code';

export const adapters: AgentAdapter[] = [
  claudeCodeAdapter,
  // codexAdapter,    // v0.3
  // aiderAdapter,    // v0.3
  // clineAdapter,    // v0.3
];

export function getAdapter(id: AdapterId): AgentAdapter | undefined {
  return adapters.find(a => a.id === id);
}
