import { requestWorker } from '../core/worker-request';
import type { SubMateSettings } from '../settings/schema';
import { loadSettings, saveSettings, watchSettings } from '../settings/store';
import {
  parseTabSettingsRecord,
  pickTabSettings,
  withTabSettings,
  type TabSettings,
  type TabSettingsRecord,
} from '../settings/tab-scope';

export type SettingsListener = (settings: SubMateSettings) => void;

/** The settings one player works from: global defaults plus its tab's own. */
export interface SettingsScope {
  load(): Promise<SubMateSettings>;
  watch(listener: SettingsListener): () => void;
  /**
   * Changes settings for this tab only. With `asDefault`, the change also
   * becomes the default for tabs opened later; other open tabs are untouched.
   */
  update(patch: Partial<TabSettings>, options: { asDefault: boolean }): Promise<void>;
  dispose(): void;
}

/**
 * Content-side view of the per-tab settings held by the background worker.
 *
 * If the worker cannot be reached the tab falls back to following the global
 * settings, which is exactly how SubMate behaved before tabs were independent.
 */
export class TabSettingsScope implements SettingsScope {
  private global: SubMateSettings | undefined;
  private tab: TabSettingsRecord | undefined;
  private readonly listeners = new Set<SettingsListener>();
  private stopWatching: (() => void) | undefined;

  async load(): Promise<SubMateSettings> {
    this.global = await loadSettings();
    this.stopWatching ??= watchSettings((settings) => {
      this.global = settings;
      this.emit();
    });
    try {
      this.accept(await requestWorker<unknown>({ type: 'TAB_SETTINGS_ATTACH' }));
    } catch {
      // Unreachable worker: keep following the global settings.
    }
    return this.current();
  }

  watch(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Applies a record broadcast by the worker. */
  receive(record: unknown): void {
    if (this.accept(record)) this.emit();
  }

  async update(patch: Partial<TabSettings>, { asDefault }: { asDefault: boolean }): Promise<void> {
    if (asDefault) await saveSettings(patch);
    try {
      this.receive(await requestWorker<unknown>({ type: 'TAB_SETTINGS_UPDATE', patch }));
    } catch {
      // Keep the change local to this document rather than dropping it. The
      // revision is not advanced, so the worker's record wins once reachable.
      const base = this.tab ?? { settings: pickTabSettings(this.current()), revision: 0 };
      this.tab = { settings: { ...base.settings, ...patch }, revision: base.revision };
      this.emit();
    }
  }

  dispose(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
    this.listeners.clear();
  }

  private current(): SubMateSettings {
    if (!this.global) throw new Error('Settings have not been loaded');
    return withTabSettings(this.global, this.tab?.settings);
  }

  private accept(value: unknown): boolean {
    const record = parseTabSettingsRecord(value);
    if (!record || (this.tab && record.revision <= this.tab.revision)) return false;
    this.tab = record;
    return true;
  }

  private emit(): void {
    if (!this.global) return;
    const settings = this.current();
    for (const listener of this.listeners) listener(settings);
  }
}
