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
- A full-name language picker with Japanese, Arabic, and French featured first,
  localized names plus explicit BCP-47 codes, and validated custom BCP-47 input;
  the picker is not a translation-capability allowlist.
- `docs/icon.png` as the source for the manifest, toolbar, popup, options, and
  generated 16/32/48/128-pixel extension icon assets.
- No backend, accounts, telemetry, external API keys, remote executable code,
  DRM/media capture, OCR, or native Netflix menu dependency.
- Independent-project disclaimer and NflxMultiSubs acknowledgement.

## Automated acceptance evidence

`npm test` covers 102 tests across parser precision/multiline/entities/overlap/empty cues; hash
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

`npm run check`, `npm run build`, `npm audit`, and the packaged manifest/security
scan are required before release.

## External acceptance gate

All repository-verifiable criteria are implemented. An authenticated Chrome 152
run on content `83068200` verified current manifest capture, a regular Japanese
text source, 521 parsed cues, full Japanese → American English preparation,
and time-index activity. It also found the hidden-overlay defect now covered by
a regression test. The overall MVP is not yet truthfully marked fully ready:
Chrome must reload the rebuilt unpacked extension so the visual fix can be
retested, after which the remaining authenticated checks in `MANUAL_TESTING.md`
(fullscreen, transitions, cache, additional pairs, and manual workflow) still
need their recorded pass/fail results.
