import { describe, expect, it } from 'vitest';
import { statusLabel } from '../../src/ui/shared/strings';

describe('user-facing state copy', () => {
  it.each([
    ['discovering', 'Finding'], ['downloading_source', 'Downloading'], ['parsing_source', 'Reading'],
    ['checking_cache', 'saved'], ['target_available', 'Netflix already'], ['needs_user_activation', 'user action'],
    ['downloading_model', 'language data'], ['translating', 'Preparing'], ['validating', 'Checking'],
    ['unsupported_image_track', 'image-based'], ['no_text_track', 'No suitable'], ['failed', 'playback can continue'],
  ] as const)('maps %s to actionable product copy', (state, phrase) => {
    expect(statusLabel({ state })).toContain(phrase);
  });

  it('distinguishes fresh, cached, and imported ready states without implementation jargon', () => {
    expect(statusLabel({ state: 'ready' })).toBe('Translated subtitles ready');
    expect(statusLabel({ state: 'ready', cacheHit: true })).toBe('Saved translation ready');
    expect(statusLabel({ state: 'ready', imported: true })).toBe('Imported translation ready');
  });
});
