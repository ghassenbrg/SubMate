import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubMateSettings } from '../../src/settings/schema';
import type { SubMateViewState } from '../../src/subtitles/models';

const originalChrome = globalThis.chrome;
const settings = (): SubMateSettings => ({
  enabled: true,
  autoTranslate: true,
  preferredTargetLanguage: 'fr',
  translationEngine: 'chrome-local',
  cloudVendor: 'gemini',
  cloudModel: '',
  cloudBaseUrl: '',
  displayMode: 'bilingual',
  translatedFontScale: 1,
  verticalPosition: .13,
  subtitleStylePreset: 'soft-box',
  subtitleBackground: 'soft',
  subtitleOutline: 'shadow',
  subtitleTextColor: '#ffffff',
  translatedFontWeight: 650,
  subtitleOpacity: 1,
  subtitleLineHeight: 1.22,
  showPlayerStatus: true,
  onboardingComplete: true,
  debugMode: false,
});

const activeState = (overrides: Partial<SubMateViewState> = {}): SubMateViewState => ({
  enabled: true,
  contentDetected: true,
  hasPlayer: true,
  contentId: '123',
  sourceLanguage: 'ja',
  sourceLanguageLabel: 'Japanese',
  targetLanguage: 'fr',
  targetLanguageLabel: 'French',
  engine: 'chrome-local',
  displayMode: 'bilingual',
  status: { state: 'ready' },
  sourceCueCount: 10,
  ...overrides,
});

let sendMessage: ReturnType<typeof vi.fn>;
let storedSettings: SubMateSettings;

async function renderPopup(state: SubMateViewState | undefined, options: { netflixTab?: boolean; onboarding?: boolean } = {}) {
  storedSettings = { ...settings(), onboardingComplete: options.onboarding ?? true };
  sendMessage = vi.fn(async (_tabId: number, message: { type: string }) => ({
    ok: true,
    value: message.type === 'CONTENT_GET_STATE' ? state : undefined,
  }));
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    writable: true,
    value: {
      i18n: { getUILanguage: () => 'en-US', getMessage: () => '' },
      storage: {
        local: {
          get: vi.fn(async () => ({ submateSettings: storedSettings })),
          set: vi.fn(async ({ submateSettings }: { submateSettings: SubMateSettings }) => { storedSettings = submateSettings; }),
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      tabs: {
        query: vi.fn(async () => options.netflixTab === false ? [] : [{ id: 1, url: 'https://www.netflix.com/watch/123' }]),
        sendMessage,
      },
      runtime: {
        getManifest: () => ({ version: '0.1.0' }),
        openOptionsPage: vi.fn(async () => undefined),
      },
    },
  });
  vi.resetModules();
  await import('../../src/ui/popup/popup');
  await vi.waitFor(() => expect(document.querySelector('#app')?.textContent).toContain('SubMate'));
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  document.body.dataset.page = 'popup';
});

afterEach(() => {
  dispatchEvent(new Event('pagehide'));
  document.body.replaceChildren();
  Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: originalChrome });
});

describe('popup acceptance states', () => {
  it('offers a concise first-run setup with a searchable full-language picker', async () => {
    await renderPopup(undefined, { onboarding: false, netflixTab: false });
    const text = document.querySelector('#app')?.textContent ?? '';
    expect(text).toContain("Translate subtitles your streaming service doesn't provide.");
    const picker = document.querySelector<HTMLButtonElement>('.language-trigger');
    picker?.click();
    await vi.waitFor(() => expect(document.querySelector('.language-options')?.textContent).toContain('Japanese (ja)'));
    const expanded = document.querySelector('#app')?.textContent ?? '';
    expect(expanded).toContain('Arabic (ar)');
    expect(expanded).toContain('French (fr)');
    expect(expanded).toContain('Next');
    [...document.querySelectorAll('button')].find((button) => button.textContent === 'Next')?.click();
    await vi.waitFor(() => expect(document.querySelector('#app')?.textContent).toContain('Get started'));
  });

  it('shows a useful non-Netflix state without a broken episode card', async () => {
    await renderPopup(undefined, { netflixTab: false });
    expect(document.querySelector('.episode')?.textContent).toContain('Open a supported video');
    expect(document.querySelector('.episode h2')).toBeNull();
  });

  it('distinguishes Netflix with no active player', async () => {
    await renderPopup(activeState({ hasPlayer: false, status: { state: 'idle' } }));
    expect(document.querySelector('.episode')?.textContent).toContain('Start a video to use translated subtitles');
  });

  it('renders determinate full-episode progress and cue counts', async () => {
    await renderPopup(activeState({
      status: { state: 'translating', progress: .5, completedCues: 5, totalCues: 10 },
    }));
    const progress = document.querySelector<HTMLProgressElement>('.episode progress');
    expect(progress?.value).toBe(.5);
    expect(document.querySelector('.episode')?.textContent).toContain('5 / 10 lines');
  });

  it('keeps browser-required activation reachable', async () => {
    await renderPopup(activeState({ status: { state: 'needs_user_activation' } }));
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Start translation');
    expect(button).toBeDefined();
    button?.click();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(1, { type: 'CONTENT_ACTIVATE' }));
  });

  it('presents failure with playback-safe copy and a working retry', async () => {
    await renderPopup(activeState({ status: { state: 'failed' } }));
    expect(document.querySelector('.episode')?.textContent).toContain('Playback can continue normally');
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Retry');
    button?.click();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(1, { type: 'CONTENT_RETRY' }));
  });
});
