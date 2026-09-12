import { NetflixAdapter } from './netflix/netflix-adapter';
import { TVerAdapter } from './tver/tver-adapter';
import type { PlatformAdapter } from './types';

export type { PlatformAdapter, PlatformCapabilities, AdapterHost, SourceSelection, ExtractedSource, PlatformId } from './types';

/**
 * Central adapter registry. Supporting another service means adding its adapter
 * here — no core translation, cache, synchronization or rendering code changes.
 */
export const createAdapters = (): PlatformAdapter[] => [new NetflixAdapter(), new TVerAdapter()];

/** Selects the adapter responsible for a location, if any. */
export function selectAdapter(
  url: URL,
  adapters: PlatformAdapter[] = createAdapters(),
): PlatformAdapter | undefined {
  return adapters.find((adapter) => adapter.matches(url));
}

/** Human-readable platform name for UI surfaces. */
export const platformLabel = (id: string): string => (id === 'netflix' ? 'Netflix' : id === 'tver' ? 'TVer' : id);
