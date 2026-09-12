# Flix Translate — Add TVer Support

## Goal

Extend **Flix Translate** from a Netflix-specific subtitle translation extension into a **multi-platform subtitle translation system**, starting with **TVer** as the second supported platform.

The implementation should preserve the existing Netflix behavior while introducing a reusable platform-adapter architecture so additional streaming services can be added later without rewriting the translation, caching, synchronization, and rendering layers.

---

## High-Level Requirements

Implement TVer support so that when a user watches a TVer program with Japanese captions:

1. Flix Translate detects that the current page is a supported TVer playback page.
2. It discovers the Japanese subtitle track exposed to the browser/player.
3. It retrieves and normalizes the subtitle cues.
4. It sends the complete episode subtitle set, or sensible batches, to the existing Flix Translate translation backend.
5. It caches translated subtitles per episode and target language.
6. It renders translated subtitles using Flix Translate's own overlay.
7. Subtitle timing stays synchronized through:
   - play/pause
   - seek
   - playback-rate changes
   - TVer advertisements
   - player/video element replacement
8. Netflix support must continue to work without regression.

Do **not** build the TVer implementation by duplicating the Netflix code.

---

# 1. Refactor Toward Platform Adapters

Move platform-specific behavior behind a common interface.

Suggested structure:

```text
src/
  platforms/
    index.ts

    netflix/
      NetflixAdapter.ts
      netflixDetection.ts
      netflixSubtitles.ts

    tver/
      TVerAdapter.ts
      tverDetection.ts
      tverManifest.ts
      tverSubtitles.ts
      tverPlayer.ts

  core/
    subtitles/
      SubtitleCue.ts
      normalizeSubtitles.ts

    translation/
      TranslationService.ts
      batching.ts

    cache/
      SubtitleCache.ts

    playback/
      SubtitleSynchronizer.ts

    renderer/
      SubtitleOverlay.ts

  content/
    bootstrap.ts
```

Example interface:

```ts
export interface StreamingPlatformAdapter {
  readonly id: string;

  matches(url: URL): boolean;

  getContentId(): Promise<string | null>;

  getOriginalLanguage(): Promise<string | null>;

  getOriginalSubtitles(): Promise<SubtitleCue[]>;

  getCurrentPlaybackTimeMs(): number | null;

  isPlaying(): boolean;

  getPlaybackRate(): number;

  subscribeToPlaybackChanges(
    callback: (event: PlaybackEvent) => void
  ): () => void;
}
```

Do not make core translation/rendering code aware of Netflix or TVer.

---

# 2. Canonical Subtitle Model

Normalize every platform into the same structure.

```ts
export interface SubtitleCue {
  id: string;

  startMs: number;
  endMs: number;

  originalText: string;

  translatedText?: string;

  originalLanguage?: string;
  translatedLanguage?: string;
}
```

Optional metadata:

```ts
export interface SubtitleTrack {
  platform: "netflix" | "tver" | string;

  contentId: string;

  originalLanguage: string;

  cues: SubtitleCue[];
}
```

All platform-specific formatting must be removed before translation.

Examples:

- WebVTT styling tags
- positioning metadata
- CSS classes
- line alignment directives
- TVer-specific presentation markup

Preserve meaningful text, speaker labels, punctuation, and line breaks where useful.

---

# 3. TVer Detection

Support TVer playback pages on:

```text
https://tver.jp/
```

Do not rely only on URL pathname patterns because TVer may change routing.

Use several signals where possible:

- hostname
- presence of the TVer player
- active HTML video element
- playback metadata
- subtitle/master manifest detection

Avoid fragile selectors when a more stable runtime/player signal exists.

---

# 4. TVer Subtitle Discovery

TVer currently provides Japanese captions for supported programs in its web player.

The implementation should discover subtitle resources dynamically rather than hard-coding CDN URLs.

Likely playback structure:

```text
TVer page
   ↓
player
   ↓
HLS master manifest (.m3u8)
   ↓
EXT-X-MEDIA
TYPE=SUBTITLES
LANGUAGE="ja-JP"
   ↓
subtitle media playlist (.m3u8)
   ↓
WebVTT segments
   ↓
*.vtt
```

The implementation must inspect the resources that the page/player is already authorized to load.

Do **not** attempt to bypass DRM, authentication, access controls, or geographic restrictions.

---

# 5. Manifest Detection

Implement a robust mechanism for detecting the active TVer HLS manifest.

Possible approaches, in preferred order:

### A. Observe player/network activity

Detect `.m3u8` requests created by the page.

Depending on extension/browser capabilities, this may involve:

- page-context injection
- wrapping `fetch`
- wrapping `XMLHttpRequest`
- `PerformanceObserver`
- Resource Timing API
- extension network APIs where permitted by the current manifest/version

Do not permanently monkey-patch browser APIs in a way that can break TVer's player.

All patches must:

- preserve original behavior
- preserve arguments
- preserve return types
- handle exceptions
- be removable where practical

### B. Player internals

If the active player exposes the current stream URL through a stable public/player property, use it.

Avoid depending on minified private property names.

---

# 6. HLS Subtitle Parsing

Given a master manifest:

1. Parse `#EXT-X-MEDIA`.
2. Find subtitle entries.

Prefer:

```text
TYPE=SUBTITLES
LANGUAGE="ja-JP"
```

Also tolerate variants such as:

```text
ja
jpn
ja-JP
```

Use the track marked default/autoselect when multiple Japanese tracks exist unless the user explicitly chooses otherwise.

Resolve relative manifest URLs using the manifest URL as the base.

Example:

```ts
const subtitleTracks = parseMasterManifest(masterText)
  .filter(track => track.type === "SUBTITLES")
  .filter(track => isJapanese(track.language));
```

Do not assume a fixed CDN host.

---

# 7. WebVTT Segment Handling

TVer subtitles may arrive as multiple WebVTT segments instead of one complete subtitle file.

Example:

```text
subtitle.m3u8
   ├── segment-000.vtt
   ├── segment-001.vtt
   ├── segment-002.vtt
   └── ...
```

The adapter must:

1. Parse the subtitle media playlist.
2. Resolve segment URLs.
3. Fetch segments.
4. Parse WebVTT.
5. normalize timestamps
6. deduplicate repeated cues
7. merge cues into a chronologically sorted episode track

Possible complications to support:

- repeated cues at segment boundaries
- timestamp offsets
- `X-TIMESTAMP-MAP`
- discontinuities
- live/sliding playlists
- duplicate segment requests
- delayed subtitle segments

Use an established WebVTT parser if one already exists in the project.

Otherwise implement a well-tested parser rather than regex-only parsing.

---

# 8. Subtitle Deduplication

When merging VTT segments, avoid duplicates.

Suggested identity:

```ts
hash(
  normalizedStartMs +
  normalizedEndMs +
  normalizedText
)
```

Allow a small timestamp tolerance if TVer slightly shifts duplicated boundary cues.

Example:

```ts
const DUPLICATE_TOLERANCE_MS = 100;
```

Do not delete two genuinely different captions that happen to contain the same text.

---

# 9. Translation Strategy

Prefer the existing Flix Translate approach:

```text
obtain full Japanese subtitle track
      ↓
normalize
      ↓
translate whole episode / large batches
      ↓
cache results
      ↓
playback only performs lookup
```

This is preferable to translating each subtitle in real time because it improves:

- translation consistency
- names/pronouns
- context
- latency
- API efficiency
- playback reliability

---

# 10. Translation Batching

If the backend cannot accept an entire episode in one request, batch by context rather than arbitrary individual lines.

Example:

```ts
interface TranslationBatch {
  cues: SubtitleCue[];
  previousContext?: string;
}
```

Target:

```text
50–150 cues per batch
```

but adapt to the translation provider's token limits.

The API should preserve cue IDs.

Example request:

```json
{
  "sourceLanguage": "ja",
  "targetLanguage": "en",
  "cues": [
    {
      "id": "cue-001",
      "text": "どうしたの？"
    },
    {
      "id": "cue-002",
      "text": "何でもない。"
    }
  ]
}
```

Expected response:

```json
{
  "translations": [
    {
      "id": "cue-001",
      "text": "What's wrong?"
    },
    {
      "id": "cue-002",
      "text": "It's nothing."
    }
  ]
}
```

Never depend on response ordering alone.

Match translations using cue IDs.

---

# 11. Cache Design

Cache translated tracks using at least:

```text
platform
contentId
sourceLanguage
targetLanguage
subtitleVersion/hash
```

Example key:

```text
flixtranslate:tver:<contentId>:ja:en:<subtitleHash>
```

The hash prevents stale translations when TVer updates captions.

Persist locally using the same storage mechanism already used by Flix Translate.

Potential options:

- IndexedDB
- extension storage
- existing Flix Translate cache abstraction

Do not retranslate the episode every time the user reloads TVer.

---

# 12. Content Identity

TVerAdapter must derive a stable content ID.

Prefer an official episode/content identifier exposed in page metadata or API/player state.

Fallback:

```text
hash(
  platform +
  normalized program title +
  normalized episode title +
  published date
)
```

Do not use the full signed CDN manifest URL as the content ID because it may expire or change.

---

# 13. Subtitle Rendering

Do not modify TVer's native subtitle DOM.

Use the existing Flix Translate overlay.

Reasons:

- TVer can rerender its own captions.
- DOM selectors can change.
- translated subtitles should behave identically across platforms.
- native and translated captions can optionally be shown simultaneously.

Desired modes:

```text
Translated only
Original only
Original + translated
Off
```

Example:

```text
          What are you doing?
             何してるの？
```

Keep UI consistent between Netflix and TVer.

---

# 14. Playback Synchronization

The renderer should use the actual active content playback time.

At minimum react to:

```text
play
pause
seeking
seeked
ratechange
timeupdate
loadedmetadata
durationchange
emptied
ended
```

However, do not depend only on `timeupdate`, because its frequency can be low.

Prefer:

```text
requestAnimationFrame
```

while playback is active.

Pseudo:

```ts
function renderLoop() {
  if (player.isPlaying()) {
    const timeMs = player.getCurrentPlaybackTimeMs();

    const cue = subtitleIndex.find(timeMs);

    renderer.render(cue);

    requestAnimationFrame(renderLoop);
  }
}
```

Use a binary-search/indexed lookup instead of scanning all cues every frame.

---

# 15. TVer Advertisements

This is one of the most important TVer-specific areas.

TVer may temporarily:

- switch video elements
- switch media manifests
- insert advertisement playback
- pause content playback
- replace player internals

Flix Translate must distinguish:

```text
CONTENT PLAYBACK
vs
ADVERTISEMENT PLAYBACK
```

During ads:

```text
hide translated subtitles
```

After the ad:

```text
resume synchronization against content time
```

Do NOT translate ad subtitles unless explicitly supported later.

---

# 16. Ad Detection Strategy

Do not depend on one CSS class.

Use a combination of signals where available:

- active video source changes
- content ID/player metadata
- ad-state events
- TVer player DOM markers
- duration changes
- manifest identity
- playback state
- known ad container elements

Expose this through the adapter:

```ts
isAdvertisementPlaying(): boolean;
```

Core code then simply does:

```ts
if (adapter.isAdvertisementPlaying()) {
  subtitleOverlay.hide();
  return;
}
```

---

# 17. Video Element Replacement

Observe player DOM changes.

TVer may replace `<video>` during:

- ads
- episode changes
- player initialization
- recovery after errors

Implement:

```ts
MutationObserver
```

around the player container.

When the video element changes:

1. detach old listeners
2. find the new active video
3. attach listeners
4. keep the same translated subtitle track
5. resynchronize using the new player's content time

Avoid leaking listeners.

---

# 18. Episode Navigation

Support TVer SPA navigation.

The extension must detect when the user moves from:

```text
Episode A
   ↓
Episode B
```

without a full page reload.

On content change:

```text
cancel pending extraction/translation for A
clear playback state
derive B content ID
load B cache
extract B subtitles
translate missing track
start B synchronization
```

Use `AbortController` for fetch and translation operations where possible.

---

# 19. Loading UX

Possible states:

```text
Flix Translate
✓ Japanese captions detected

Preparing translation…
42%

Translated subtitles ready
```

If cached:

```text
Translated subtitles ready
```

should appear almost immediately.

If TVer has no subtitle track:

```text
Japanese captions are not available for this episode.
```

Do not show a generic failure if the actual problem is simply absence of captions.

---

# 20. Error States

Handle these independently:

```ts
enum SubtitleLoadError {
  NoPlayer,
  NoManifest,
  NoJapaneseSubtitleTrack,
  SubtitleManifestFailed,
  SubtitleSegmentFailed,
  SubtitleParseFailed,
  TranslationFailed,
  UnsupportedPlayerState
}
```

Logs should contain enough information for debugging without leaking signed stream URLs or sensitive request data.

---

# 21. Retry Behavior

Network failures should retry conservatively.

Suggested:

```text
attempt 1
500 ms
attempt 2
1500 ms
attempt 3
3000 ms
fail gracefully
```

Do not infinitely retry subtitle or translation requests.

If only one VTT segment fails, do not necessarily discard the entire track.

Record partial failure and retry that segment.

---

# 22. Security / Privacy

The extension must not send:

- TVer cookies
- authentication headers
- signed media URLs
- unrelated browsing data
- video/audio content

to the translation backend.

Only send subtitle text and the minimum metadata needed for translation.

Example:

```json
{
  "sourceLanguage": "ja",
  "targetLanguage": "en",
  "cues": [...]
}
```

---

# 23. Permissions

Review extension permissions carefully.

Do not add broad permissions unless required.

Prefer explicit host permissions such as:

```json
{
  "host_permissions": [
    "*://*.netflix.com/*",
    "*://tver.jp/*"
  ]
}
```

If TVer subtitle manifests are served from another domain and Chrome requires explicit permission, add only the necessary domain(s).

Do not use:

```text
<all_urls>
```

unless there is a strong documented reason.

---

# 24. Platform Registry

Create one central registry:

```ts
const adapters: StreamingPlatformAdapter[] = [
  new NetflixAdapter(),
  new TVerAdapter(),
];
```

Selection:

```ts
const adapter = adapters.find(adapter =>
  adapter.matches(new URL(location.href))
);
```

This should make future support straightforward:

```text
PrimeVideoAdapter
DisneyPlusAdapter
UNextAdapter
HuluJapanAdapter
```

without changing core translation logic.

---

# 25. Capability Model

Different platforms may expose different capabilities.

Add:

```ts
interface PlatformCapabilities {
  supportsOriginalSubtitles: boolean;

  supportsFullEpisodeExtraction: boolean;

  supportsDualSubtitles: boolean;

  supportsEpisodeDetection: boolean;

  supportsAdDetection: boolean;
}
```

Example:

```ts
TVerAdapter.capabilities = {
  supportsOriginalSubtitles: true,
  supportsFullEpisodeExtraction: true,
  supportsDualSubtitles: true,
  supportsEpisodeDetection: true,
  supportsAdDetection: true,
};
```

Do not hard-code behavior based on platform string in core code.

---

# 26. Performance

For an episode containing thousands of cues:

Do not do:

```ts
cues.find(...)
```

on every animation frame.

Build a binary searchable timeline:

```ts
class SubtitleTimeline {
  findCueAt(timeMs: number): SubtitleCue | null;
}
```

Expected lookup:

```text
O(log n)
```

Rendering should only update the DOM when the displayed cue changes.

---

# 27. Tests

Add proper automated tests.

## HLS parser tests

Fixtures:

```text
master-with-japanese-subtitles.m3u8
master-with-multiple-subtitles.m3u8
subtitle-playlist.m3u8
subtitle-playlist-relative-urls.m3u8
```

Verify:

- Japanese track detection
- relative URL resolution
- missing subtitles
- malformed manifests

---

## WebVTT tests

Fixtures should include:

```text
basic captions
multiline captions
styling tags
Japanese text
segment overlaps
X-TIMESTAMP-MAP
duplicate boundary cues
```

Verify:

- timing
- normalization
- deduplication
- Unicode preservation

---

## Playback tests

Test:

```text
play
pause
seek forward
seek backward
rate 0.5x
rate 1.5x
rate 2x
ad start
ad end
video replacement
episode navigation
```

---

## Cache tests

Verify:

```text
same episode + same language → cache hit
same episode + different language → miss
subtitle hash changed → miss
episode changed → miss
```

---

# 28. Manual TVer Test Checklist

Test at least 3 caption-supported TVer programs.

For every test:

```text
[ ] extension detects TVer
[ ] Japanese subtitle track found
[ ] VTT segments load
[ ] cues are ordered correctly
[ ] translation starts
[ ] cached translation loads after reload
[ ] translated subtitle timing is correct
[ ] seek forward works
[ ] seek backward works
[ ] pause/resume works
[ ] playback-rate changes work
[ ] subtitle UI remains readable fullscreen
[ ] native Japanese subtitles can coexist
[ ] ads do not show stale translated dialogue
[ ] translation resumes after ads
[ ] video replacement does not break subtitles
[ ] SPA episode switch loads new subtitles
```

Also test:

```text
[ ] episode without TVer captions
[ ] network temporarily offline
[ ] translation API unavailable
[ ] one subtitle segment unavailable
[ ] browser refresh during translation
```

---

# 29. Logging

Introduce namespaced debug logging.

Example:

```text
[FlixTranslate:TVer] player detected
[FlixTranslate:TVer] master manifest detected
[FlixTranslate:TVer] Japanese subtitle track detected
[FlixTranslate:TVer] 187 VTT segments discovered
[FlixTranslate:TVer] 912 subtitle cues normalized
[FlixTranslate:Translation] cache hit en
```

Never log full signed media URLs in production.

Debug mode may expose additional information locally.

---

# 30. Acceptance Criteria

TVer support is complete only when all of the following are true:

### Functional

- TVer is automatically detected.
- Caption-enabled TVer episodes can be translated.
- Japanese subtitles are extracted from resources exposed to the web player.
- Translation supports all languages already supported by Flix Translate.
- User does not have to manually download subtitles.
- Translation survives seeks and pause/resume.
- Translation correctly resumes after advertisements.
- Episode changes are detected without page reload.
- Cached translations are reused.

### Architecture

- Netflix still works.
- Netflix code is moved behind `NetflixAdapter`.
- TVer is implemented as `TVerAdapter`.
- Translation logic contains no TVer-specific code.
- Rendering logic contains no TVer-specific code.
- Playback synchronization contains no TVer-specific code.
- Future streaming adapters can be introduced without rewriting core functionality.

### Quality

- no duplicate subtitle lines
- no stale subtitle after seeking
- no subtitle during ads
- no permanent monkey-patch that breaks TVer
- no listener leaks
- no repeated translation request after reload
- graceful errors
- unit tests passing
- manual TVer test checklist passing

---

# 31. Implementation Order

Implement incrementally.

## Phase 1 — Refactor

```text
existing Netflix implementation
      ↓
StreamingPlatformAdapter
      ↓
NetflixAdapter
```

Make sure Netflix still works before TVer work begins.

---

## Phase 2 — TVer Discovery

Implement:

```text
TVer page detection
player detection
video detection
content ID
manifest discovery
```

Add debug logging.

---

## Phase 3 — Subtitle Extraction

Implement:

```text
master playlist parser
Japanese subtitle track detection
subtitle media playlist parser
VTT loading
VTT parsing
normalization
deduplication
```

At the end of this phase print/debug a complete normalized Japanese subtitle track.

Do not implement rendering hacks before extraction is reliable.

---

## Phase 4 — Translation

Connect normalized TVer cues to the existing TranslationService.

Verify:

```text
Japanese cues
→ existing backend
→ translated cues
```

---

## Phase 5 — Playback

Connect:

```text
TVer playback time
+
translated subtitle timeline
+
existing subtitle renderer
```

Verify seek and playback speed.

---

## Phase 6 — Ads

Implement ad detection.

Verify:

```text
content
→ translated subtitle

ad
→ overlay hidden

content resumes
→ translated subtitle resumes correctly
```

---

## Phase 7 — Cache

Implement/reuse episode translation caching.

Reloading an already translated episode should not call the translation backend again unless:

```text
subtitle source changed
or
target language changed
```

---

## Phase 8 — Production Hardening

Run:

- unit tests
- integration tests
- manual TVer tests
- Netflix regression tests
- Chrome extension build

Fix all warnings/errors.

Do not stop at a proof of concept.

Deliver this as production-ready support.

---

# 32. Important Constraint

Do not design this as:

```text
Netflix extension
+ random TVer hacks
```

The intended result is:

```text
                Flix Translate
                      │
         ┌────────────┴────────────┐
         │                         │
   platform adapters         platform-independent core
         │                         │
 ┌───────┴────────┐        ┌───────┴─────────────────┐
 │                │        │                         │
NetflixAdapter  TVerAdapter Translation / Cache / Sync / UI
```

This refactor is important because TVer should be only the **second platform**, not the last one.

---

# 33. References

TVer officially supports captions on supported programs in its web player:

- TVer Help — 字幕対応番組での字幕設定方法  
  https://help.tver.jp/hc/ja/articles/5106379095577

Public technical analysis has documented TVer HLS playback exposing Japanese WebVTT subtitle playlists via `EXT-X-MEDIA` subtitle tracks:

- Qiita — TVer subtitle/HLS analysis  
  https://qiita.com/owayo/items/a4efd7fc92c9c413fe6e

Treat the public technical analysis as an implementation lead, **not as a guaranteed description of TVer's current internal implementation**. Inspect current TVer traffic/player behavior during development and keep the adapter resilient to changes.

---

# Final Instruction to the Agent

Please inspect the existing Flix Translate codebase first and adapt this design to its current architecture rather than blindly creating duplicate abstractions.

Reuse existing:

- translation API
- settings
- language configuration
- subtitle renderer
- caching
- extension UI
- tests/helpers

where they are already suitable.

Refactor only where needed to establish a clean multi-platform architecture.

Keep working through implementation and testing until:

```text
Netflix works
+
TVer works
+
tests pass
+
production build succeeds
```

and document any TVer behavior that could not be made fully deterministic.
