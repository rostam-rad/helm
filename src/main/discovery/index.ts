/**
 * Discovery orchestrator.
 *
 * Asks every enabled adapter for its candidate paths, validates each,
 * and returns the set of valid (adapter, path) pairs the rest of the
 * app should consume.
 *
 * This module is intentionally thin. The actual probe logic lives in
 * each adapter, because what counts as a valid Claude Code path is
 * different from what counts as a valid Aider path.
 */

import { adapters } from '../adapters';
import type { AdapterId, ValidationResult } from '../../shared/types';
import log from 'electron-log';

export interface DiscoveryResult {
  adapter: AdapterId;
  path: string;
  result: ValidationResult;
}

export async function runDiscovery(enabledAdapters: AdapterId[]): Promise<DiscoveryResult[]> {
  const out: DiscoveryResult[] = [];

  for (const adapter of adapters) {
    if (!enabledAdapters.includes(adapter.id)) continue;

    let candidates: string[];
    try {
      candidates = await adapter.discoverPaths();
    } catch (err) {
      log.warn(`[discovery] ${adapter.id} discoverPaths threw`, err);
      continue;
    }

    for (const path of candidates) {
      try {
        const result = await adapter.validatePath(path);
        out.push({ adapter: adapter.id, path, result });
      } catch (err) {
        log.warn(`[discovery] ${adapter.id} validatePath(${path}) threw`, err);
        out.push({ adapter: adapter.id, path, result: { ok: false, reason: 'Validation error' } });
      }
    }
  }

  return out;
}
