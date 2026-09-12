import { NetflixAdapter } from './netflix/netflix-adapter';
import { PrimeVideoAdapter } from './prime/prime-adapter';
import { TVerAdapter } from './tver/tver-adapter';
import type { PlatformAdapter } from './types';

export type { PlatformAdapter, PlatformCapabilities, AdapterHost, SourceSelection, ExtractedSource, PlatformId } from './types';

/**
 * Central adapter registry. Supporting another service means adding its adapter
 * here — no core translation, cache, synchronization or rendering code changes.
 */
export const createAdapters = (): PlatformAdapter[] => [
  new NetflixAdapter(),
  new TVerAdapter(),
  new PrimeVideoAdapter(),
];

/** Selects the adapter responsible for a location, if any. */
export function selectAdapter(
  url: URL,
  adapters: PlatformAdapter[] = createAdapters(),
): PlatformAdapter | undefined {
  return adapters.find((adapter) => adapter.matches(url));
}

const PLATFORM_LABELS: Record<string, string> = {
  netflix: 'Netflix',
  tver: 'TVer',
  prime: 'Prime Video',
};

/** Human-readable platform name for UI surfaces. */
export const platformLabel = (id: string): string => PLATFORM_LABELS[id] ?? id;
