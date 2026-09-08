# MVP specification audit

Audit date: 2026-09-08

## Implemented and automated

- MV3 Chrome 138+ build with Netflix-only early MAIN/ISOLATED content scripts.
- Bounded, schema-validated page bridge, Netflix HTTPS resource allowlist, and
  page-realm downloads with no privileged page-directed URL fetch.
- Current/legacy manifest field adapters, preload rejection, SPA identity and
  hydrated-track update handling, generic source selection, and image-only state.
- DFXP/TTML (ticks, clock, offsets, frames, nested spans, entities, multiline),
  WebVTT, and SRT parsing into deterministic integer-millisecond cues.
- SHA-256 source identity and cache keys containing source, target, engine, and
  engine version.
- Chrome Translator document-context provider, activation/download states,
  chunked sequential full-episode preparation, progress, cancellation, exact-ID
  validation, and no translator timing control.
- Extension-origin IndexedDB source/translation/content stores coordinated by
  an ephemeral-safe MV3 worker; cache hits update use time and clear-cache does
  not change settings.
- Indexed/binary-search cue lookup, overlapping cues, pause/seek/speed behavior,
  fullscreen reparenting, resize-safe CSS, native-subtitle offset, bilingual/
  translation-only/off modes, CJK/RTL/mixed-script-safe `dir=auto`, and text-only
  rendering.
- Canonical JSON plus SRT/VTT export/import, hash and exact-ID validation,
  bounded inputs, timing-tolerance alignment, inert markup, and cached imports.
- First-run locale-derived onboarding; stable accessible popup; in-player quick
  control; target, engine, display, appearance, storage, error, progress, cache,
  and developer-diagnostic surfaces; complete English, French, Japanese, and
  Arabic UI catalogs with RTL layout and localized language names.
- A live-preview subtitle appearance editor with Netflix-like, soft-background,
  solid-black, outline, and minimal presets; safe custom background, outline,
  color, weight, opacity, line-spacing, size, and position controls; and an
  accessible in-player mode selector with an explicit checked state.
- A full-name language picker with Japanese, Arabic, and French featured first,
  localized names plus explicit BCP-47 codes, and validated custom BCP-47 input;
  the picker is not a translation-capability allowlist.
- `docs/icon.png` as the source for the manifest, toolbar, popup, options, and
  generated 16/32/48/128-pixel extension icon assets.
- No backend, accounts, telemetry, external API keys, remote executable code,
  DRM/media capture, OCR, or native Netflix menu dependency.
- Independent-project disclaimer and NflxMultiSubs acknowledgement.

## Automated acceptance evidence

`npm test` covers 118 tests across parser precision/multiline/entities/overlap/empty cues; hash
invalidation; cache isolation; exact/missing/duplicate/unknown cue validation;
chunk order/limits; IndexedDB hit/miss/clear; JSON/SRT/VTT imports; malicious
strings; manifest current/legacy shapes and URL attacks; cue boundaries/gaps/
backward seek; all main UI states; locale-catalog parity and RTL; fake Translator
model progress; and synthetic episode translation/render/seek/display behavior,
including the live-discovered hidden-overlay regression.
It also covers Netflix next-episode preload replay, URL redaction, hydrated
manifest updates, and bounded page-realm retention discovered during autoplay.
The ready player indicator is also verified to fade after success and return on
pointer activity, while actionable states remain reachable.
Player replacement/removal, settings persistence/canonicalization, and MV3
worker installation/cache-message routing have dedicated regression coverage.
Popup acceptance tests exercise first-run language names, non-Netflix and
no-player states, determinate episode progress, activation, failure, and retry.
Options acceptance tests exercise appearance presets, custom transitions, and
live preview variables; renderer tests cover safe style variables and selected
quick-control state.
Late bridge attachment, retained-manifest requests, exact content-to-source
recovery, cached reloads, and target changes without a fresh manifest have
dedicated regressions; a cached old target is cleared rather than rendered.

`npm run check`, `npm run build`, `npm audit`, and the packaged manifest/security
scan are required before release.

## External acceptance gate

All repository-verifiable criteria are implemented. Authenticated Chrome 152
verified current manifest capture, a regular Japanese text source, 521 parsed
cues, full episode preparation, cache recovery after an extension/page reload,
and visible synchronized rendering on content `83068200`. The final renderer
showed one French translation above one Netflix Japanese cue with no duplicated
source line. A second live content ID, `82904953`, freshly rendered a mixed RTL
Japanese → Arabic translation while Netflix native subtitles were off, proving
that bilingual fallback renders both source and target without a language-pair
special case. Popup width, full language names, Ready state, quick controls,
version, and GitHub footer were also inspected in the rebuilt extension.

The core MVP success scenario is now demonstrated. Full release-matrix signoff
is still not equivalent to “every external condition verified”: the remaining
authenticated checks in `MANUAL_TESTING.md` include fullscreen/playback-rate,
source-track switching, next-episode autoplay, destructive cache clearing,
model-download failures, invalid imports, image-only titles, and additional
regions/profiles.
