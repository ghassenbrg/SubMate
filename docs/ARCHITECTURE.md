# SubMate architecture

SubMate is a multi-platform subtitle translation extension. Platform
knowledge lives in adapters; everything else is shared.

```text
                      SubMate
                            │
             ┌──────────────┴───────────────┐
             │                              │
      platform adapters            platform-independent core
             │                              │
   ┌─────────┴─────────┐        ┌───────────┴────────────────┐
   │                   │        │                            │
NetflixAdapter  TVerAdapter  translation · cache · sync ·
PrimeVideoAdapter            overlay · settings · UI · errors
```

## Layout

```text
src/
  platforms/
    index.ts                  adapter registry + selection
    types.ts                  PlatformAdapter, capabilities, selection model
    netflix/
      netflix-adapter.ts      Netflix behind the shared contract
      netflix-bridge.ts       MAIN-world manifest bridge (isolated side)
      native-captions.ts      reads Netflix's own timed-text layer
    prime/
      prime-adapter.ts        Prime Video behind the shared contract
      prime-detection.ts      host + path scoping, ASIN extraction
      prime-manifest.ts       structural playback-payload parsing
      prime-bridge.ts         page-world bridge (isolated side)
      prime-player.ts         Prime ad selectors
      prime-url-policy.ts     Amazon host allowlist
    tver/
      tver-adapter.ts         TVer behind the shared contract
      tver-detection.ts       host + route + runtime detection
      tver-bridge.ts          page-world bridge (isolated side)
      tver-player.ts          content-vs-ad video, ad signals
      tver-subtitles.ts       segmented WebVTT → normalized cues
      tver-types.ts           bridge protocol + hard limits

  core/
    hls/manifest.ts           EXT-X-MEDIA + media playlist parsing
    subtitles/language.ts     BCP-47 / ISO-639 matching
    subtitles/segments.ts     X-TIMESTAMP-MAP, merge, dedupe
    playback/video-observer.ts video element tracking + replacement
    playback/ad-signals.ts    selector-driven advertisement detection
    retry.ts                  bounded backoff

  page/
    netflix-manifest-agent.ts MAIN-world Netflix agent
    tver-media-agent.ts       MAIN-world TVer agent
    prime-media-agent.ts      MAIN-world Prime Video agent

  content/
    bootstrap.ts              selects an adapter, starts the orchestrator
    episode-orchestrator.ts   the platform-independent pipeline
```

## The adapter contract

An adapter answers five questions and reports runtime changes:

| Method | Responsibility |
| --- | --- |
| `matches(url)` | Does this adapter own the page? |
| `getContentId()` | Stable identifier for what is playing |
| `selectSource(settings)` | Which original track to translate, or why none |
| `extractSource(sel, signal)` | Produce normalized cues for that track |
| `getVideo()` / `isAdPlaying()` | Current playback element and ad state |

Changes are pushed back through `AdapterHost`: `onContentChanged`,
`onSourceAvailabilityChanged`, `onVideoChanged`, `onAdStateChanged`, `debug`.

`selectSource` returns a discriminated outcome rather than a nullable track, so
each ordinary situation gets its own user-facing state instead of a generic
failure:

```ts
{ kind: 'pending' }           // not enough information yet
{ kind: 'ready', ... }        // translatable track found
{ kind: 'target-available' }  // platform already offers the target language
{ kind: 'image-only' }        // bitmap subtitles only
{ kind: 'none' }              // genuinely no text captions
```

## What the core guarantees

* **No platform branches.** The orchestrator, overlay, cache, translation and
  settings never test for `'netflix'` or `'tver'`. The one platform-shaped value
  in core is `SubtitleTrack.platform`, used as a cache namespace and an export
  label.
* **The renderer is injected, not aware.** `SubtitleOverlay.setPlaybackContext()`
  supplies ad state and a native-caption reader. That is how Netflix's timed-text
  scraping and TVer's `textTracks` reading both work without the renderer
  knowing either exists.
* **Cancellation is generational.** Every pipeline run carries a generation
  number plus an `AbortController`; an episode change invalidates in-flight work
  so a slow Episode A can never render over Episode B.
* **Cache keys are namespaced.** The content index is keyed
  `<platform>:<contentId>`, and translations by
  `hash(sourceHash | targetLanguage | engineId | engineVersion)` — so changed
  captions, a changed target language or a changed engine all miss correctly.

## Adding a platform

1. Implement `PlatformAdapter` under `src/platforms/<name>/`.
2. Register it in `src/platforms/index.ts`.
3. Add host permissions and content scripts to `public/manifest.json`.
4. If the platform needs page-realm access, add a MAIN-world agent under
   `src/page/` and keep signed URLs inside it.

No core file needs to change.

## Translation engines

Engines sit behind `TranslationProvider` (`src/translation/provider.ts`) and are
selected by `createProvider()` (`src/translation/provider-factory.ts`):

| Engine | Where it runs | Notes |
| --- | --- | --- |
| `chrome-local` | Content script | Chrome's on-device Translator API. Default. |
| `cloud-api` | Background worker | Bring-your-own-key. See `CLOUD_TRANSLATION.md`. |
| `manual` | — | Export/import round trip. |

The cache key includes the engine id and version, so engines coexist per episode
and switching engines misses rather than serving another engine's output.

The API key lives outside `SubMateSettings`, in its own `storage.local` entry
that only the background worker and options page read — the content script never
receives it.

## Interface theme

Three surfaces render SubMate's UI, and all three draw from one palette sampled
from the extension mark (`docs/icon.png`): a deep navy ground, the cyan-to-blue
play gradient, and the gold sync badge.

| Surface | Markup | Styles |
| --- | --- | --- |
| Popup | `src/ui/popup/popup.ts` | `public/ui/popup.css` |
| Options | `src/ui/options/options.ts` | `public/ui/options.css` |
| In-player overlay | `src/renderer/subtitle-overlay.ts` | inline, in its shadow root |

`public/ui/theme.css` holds the tokens (`--cyan`, `--blue`, `--gold`, surfaces,
text, status colours) plus the shared control primitives — selects, switches,
ranges, buttons, focus rings. Both extension pages `@import` it; the overlay
cannot, because a shadow root does not inherit page stylesheets, so it carries
its own copy of the same values.

Status colour is consistent across surfaces: gold while work is in progress
(matching the badge on the mark), green when ready, red on failure.

The overlay's logo mark is inline SVG rather than a reference to `icons/`.
Loading a packaged image from a page would require a `web_accessible_resources`
entry, which makes the extension trivially detectable by any site the user
visits.

Subtitle rendering itself is driven by `--ft-*` custom properties written from
`subtitleAppearanceVariables()`, so the options preview and the real overlay
style cues through the same variables.
