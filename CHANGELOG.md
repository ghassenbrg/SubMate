# Changelog

All notable changes to SubMate are documented here. This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0]

### Added

- **TVer support.** Japanese captions are assembled from the segmented HLS WebVTT the authorized player already exposes, merged and de-duplicated across segments into one episode track.
- **Cloud translation engine.** An opt-in, bring-your-own-key engine that works with Google Gemini, OpenAI, Anthropic, Mistral, DeepSeek, xAI, Groq, OpenRouter, or any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, LiteLLM). It translates in batches with surrounding context, for higher quality than per-line on-device translation. Keys are stored per provider in their own `storage.local` entry that the content script never receives, provider hosts are optional permissions requested only when chosen, and results are reconciled by cue id so a dropped line cannot shift later subtitles.
- **Amazon Prime Video support**, built on the same adapter contract with no changes to the shared core.
- **Platform-adapter architecture.** Translation, caching, synchronization, rendering, language selection, settings, and error handling are now platform-independent; each service is a `PlatformAdapter`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Advertisement detection, so translated subtitles are hidden during ad breaks and resynchronize against content time afterwards.
- Blank imported cues now fall back to the original subtitle text instead of leaving a gap on screen.
- The subtitle overlay anchors to the video element's box, so it stays aligned in windowed playback.

### Changed

- **Renamed from FlixTranslate to SubMate**, with new artwork. `docs/icon.png` is the master; the PNG icons are resized from it and the in-player mark follows its vector redraw.
- Redesigned the popup, options page, and in-player controls around one navy, cyan and blue palette sampled from the icon, with shared tokens in `public/ui/theme.css`. The light/dark/system theme is a setting, so the in-player controls follow it too.
- The appearance preview renders cues over a stand-in video frame with bright and dark areas instead of a flat dark box.
- The in-player button hides along with the player's own controls when the pointer is idle.
- Subtitle import tolerates partially-translated files rather than rejecting the whole import.

### Fixed

- TVer subtitles were offset by several seconds because the stream's presentation-clock origin was not subtracted from `X-TIMESTAMP-MAP`.
- The in-player control was invisible against light pages, and faded out under a stationary cursor.
- Every button fell back to the browser's default font, because a `font` shorthand ending in `inherit` is invalid CSS and was dropped.
- The options diagnostics panel reported no supported tab when an episode was playing in another window.

## 0.1.0

Initial Netflix-only Manifest V3 extension: on-device translation, synchronized rendering, local caching, import/export, and English, Japanese, Arabic, and French localizations. Never tagged or published.
