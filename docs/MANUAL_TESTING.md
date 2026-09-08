# Authenticated Chrome / Netflix verification

These are the exact remaining external verification steps. Do not treat a
reference-repository inspection or synthetic fixture as live Netflix proof.

## Recorded live session — 2026-09-08

- Browser: Google Chrome 152.0.7977.76 on macOS, authenticated Netflix session.
- Title: `https://www.netflix.com/watch/83068200?trackId=253628477`.
- Passed: current episode interception; Japanese regular text-track selection;
  subtitle download and parsing; 521 normalized cues; Japanese → American
  English on-device preparation to Ready; one active time-indexed cue; Netflix
  playback continued normally.
- Initially failed in the loaded bundle: translated text was not visible even
  though the active cue and Ready state were present. Root cause was the overlay
  show path inheriting its stylesheet's `display:none` rule.
- Passed after rebuild/reload: content `83068200` visibly rendered French above
  Netflix's Japanese cue. Only one Japanese source line remained; FlixTranslate
  suppressed its duplicate source while the native cue was visible. Responsive
  subtitle sizing and the compact quick panel were also visible.
- The unattended session then autoplayed to content `83068201`. The previous
  episode was cleared and only one FlixTranslate root remained, but the loaded
  bundle stayed in Discovering because Netflix had preloaded Episode B's
  manifest before changing the route. The current build now retains a bounded
  page-realm preload window and replays the matching safe manifest immediately
  after `/watch/<id>` navigation; four regression cases cover replay, URL
  redaction, hydration changes, and bounded retention.
- Passed reload/cache recovery: when Netflix resumed without producing a fresh
  usable manifest, the rebuilt extension recovered the exact 521-line cached
  source and selected manual target using the source-hash/target/engine cache
  identity; popup and quick panel returned to Ready without retranslating.
- Passed a second content/title check: content `82904953` freshly rendered a
  Japanese → Arabic mixed-script translation. With Netflix subtitles set to
  Off, bilingual mode correctly rendered both its Japanese source and Arabic
  target. This was observed in the authenticated player, not inferred from a
  fixture.
- Passed popup inspection: the popup opened at its intended width with complete
  language names/codes, unclipped episode state, manual engine, version, and
  GitHub footer.

All unchecked scenarios below remain required release-matrix evidence even
though the core live extraction, reload/cache, and rendering paths have now
been exercised on two content IDs.

## Setup

1. Run `npm install && npm run build`.
2. Open Chrome 138 or newer on desktop and visit `chrome://extensions`.
3. Enable Developer mode, choose **Load unpacked**, and select this repository's
   `dist/` folder.
4. Sign into Netflix normally. Do not share credentials with the extension.
5. Open FlixTranslate, choose any target BCP-47 language supported by Chrome,
   and complete onboarding.
6. In Advanced settings, enable Developer diagnostics for the test session.

## Manifest and source extraction

Use region/account-appropriate titles; do not rely on one fixed catalog item.

- Open a title with a text subtitle whose source differs from the target.
- Confirm diagnostics shows the `/watch/<id>` content ID, source language,
  track ID, profile, nonzero cue count, and a SHA-256 source hash.
- Confirm a textual representation is preferred when the same language also
  exposes image subtitle assets.
- Export FlixTranslate JSON and inspect ordered IDs, integer millisecond timing,
  source language, and source hash.
- Repeat with representative Latin, CJK, and RTL source/target scripts.
- Switch the Netflix source subtitle and confirm a new track/hash is prepared.

## Translator API

- Test **Start translation** from the in-player control and from the popup.
- Record whether `Translator.create()` requires activation when the pair is
  already downloaded and when it is downloadable.
- Confirm language data progress appears and reaches Ready.
- Confirm the complete episode is prepared without per-display cue requests.
- Let Netflix navigate to the next episode. Verify the existing translator is
  reused only for the same pair and otherwise requests activation accurately.
- Reload the page and verify activation behavior is accurately represented.
- Test several pairs selected through arbitrary BCP-47 input; record Chrome's
  actual `availability()` results rather than assuming a static list.

## Playback and layout

- Pause/resume, seek forward/back, and change playback speed.
- Enter/leave fullscreen, resize the window, and vary OS display scaling.
- Show/hide Netflix native subtitles and check collision offset.
- Switch bilingual, translation-only, and off modes from both UI surfaces.
- Confirm no stale cue survives a seek and only one FlixTranslate root exists.
- Let the next episode autoplay while translation is in progress; Episode A
  must never render over Episode B.
- Open Advanced settings and try Netflix-like, soft-background, solid-black,
  outline, and minimal subtitle presets. Confirm the preview and active player
  update, the black background can be removed/restored, and Custom is selected
  after changing background, outline, color, weight, opacity, or line spacing.
- Confirm the in-player display-mode control clearly checks exactly one active
  mode and that its compact FT trigger does not obscure Netflix controls.

## Cache and manual workflow

- Reload an unchanged episode and confirm the popup says **Saved translation
  ready** without fake progress or Translator calls.
- Clear the cache and confirm translation preparation runs again.
- Export JSON, create an ID-preserving translation package, import it, and
  confirm immediate rendering and persistence.
- Import a wrong-hash JSON, duplicate/missing-ID JSON, mis-timed SRT/VTT, and
  markup/script strings. Each must fail safely or render literal text.

## Error states

- Test no subtitle tracks, text unavailable/image-only, unsupported pair,
  language download failure/offline, subtitle download failure, and malformed
  import. Playback must continue and each state must offer the documented
  action/fallback.

Record Chrome version, Netflix region/profile, content IDs (not account data),
observed profiles/host suffixes, pass/fail, and screenshots for failures.
