import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/settings/defaults';
import type { FlixTranslateSettings } from '../../src/settings/schema';

vi.mock('../../src/cache/messages', () => ({
  sendCacheMessage: vi.fn(async (message: { type: string }) => message.type === 'CACHE_STATS' ? { translations: 2, sources: 1 } : undefined),
}));
vi.mock('../../src/ui/shared/messages', () => ({ sendContent: vi.fn(async () => ({})) }));

const originalChrome = globalThis.chrome;
let storedSettings: FlixTranslateSettings;

function rowControl(label: string): HTMLElement {
  const item = [...document.querySelectorAll<HTMLElement>('.row')].find((candidate) => candidate.querySelector('strong')?.textContent === label);
  if (!item) throw new Error(`Missing row: ${label}`);
  return item;
}

async function renderOptions(): Promise<void> {
  storedSettings = { ...defaultSettings(), onboardingComplete: true };
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    writable: true,
    value: {
      i18n: { getUILanguage: () => 'en-US', getMessage: () => '' },
      storage: {
        local: {
          get: vi.fn(async () => ({ flixtranslateSettings: storedSettings })),
          set: vi.fn(async ({ flixtranslateSettings }: { flixtranslateSettings: FlixTranslateSettings }) => { storedSettings = flixtranslateSettings; }),
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      runtime: { getManifest: () => ({ version: '0.1.0' }) },
    },
  });
  vi.resetModules();
  await import('../../src/ui/options/options');
  await vi.waitFor(() => expect(document.querySelector('.subtitle-preview')).not.toBeNull());
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  document.body.dataset.page = 'options';
});

afterEach(() => {
  document.body.replaceChildren();
  Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: originalChrome });
});

describe('subtitle appearance settings', () => {
  it('offers clear presets and all practical custom controls with a preview', async () => {
    await renderOptions();
    const preset = rowControl('Subtitle style').querySelector('select');
    expect([...preset!.options].map((option) => option.text)).toEqual([
      'Netflix-like', 'Soft background', 'Solid black background', 'Outline', 'Minimal', 'Custom',
    ]);
    for (const label of ['Subtitle background', 'Text outline', 'Text color', 'Text weight', 'Font size', 'Opacity', 'Line spacing', 'Vertical position']) {
      expect([...document.querySelectorAll('.row strong')].filter((node) => node.textContent === label)).toHaveLength(1);
    }
    expect(document.querySelector('.subtitle-preview')?.textContent).toContain('Translated subtitle');
  });

  it('applies a preset and marks an individual background adjustment as custom', async () => {
    await renderOptions();
    const preset = rowControl('Subtitle style').querySelector('select')!;
    preset.value = 'netflix';
    preset.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(storedSettings.subtitleStylePreset).toBe('netflix'));
    expect(storedSettings.subtitleBackground).toBe('none');
    expect(document.querySelector<HTMLElement>('.subtitle-preview')?.style.getPropertyValue('--ft-background')).toBe('transparent');

    const opacity = rowControl('Opacity').querySelector('input')!;
    opacity.value = '.8';
    opacity.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(storedSettings.subtitleStylePreset).toBe('custom'));
    expect(rowControl('Subtitle style').querySelector<HTMLSelectElement>('select')?.value).toBe('custom');
    expect(document.querySelector<HTMLElement>('.subtitle-preview')?.style.getPropertyValue('--ft-opacity')).toBe('0.8');

    const background = rowControl('Subtitle background').querySelector('select')!;
    background.value = 'solid';
    background.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(storedSettings.subtitleBackground).toBe('solid'));
    expect(storedSettings.subtitleStylePreset).toBe('custom');
    expect(document.querySelector<HTMLElement>('.subtitle-preview')?.style.getPropertyValue('--ft-background')).toBe('rgba(0,0,0,.94)');
  });
});
