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

1. Run `npm ci && npm run build:chrome`.
2. Open Chrome 138 or newer on desktop and visit `chrome://extensions`.
3. Enable Developer mode, choose **Load unpacked**, and select this repository's
   `dist/chrome/` folder.
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

---

# TVer verification

## Status: NOT YET PERFORMED LIVE

TVer support has **not** been verified against live caption-enabled episodes.
This section is a checklist to execute, not a record of results. Do not treat
the automated suite as a substitute: it covers parsing, merging, dedupe, ad
gating, synchronization and teardown against fixtures, but it cannot prove what
TVer's production stream actually contains.

### Why it could not be run here

The environment had no usable browser for TVer. The available sandbox browser
blocked TVer's own `_next/static` chunks (`ERR_BLOCKED_BY_CLIENT`), so the SPA
never booted and no player existed to observe, and no ordinary Chrome instance
was connected. Network egress *was* in Japan and `tver.jp` returned HTTP 200, so
geo-restriction was not the blocker.

What that leaves unproven is listed under "Not verified" in
`TVER_SUPPORT_NOTES.md` — above all, whether Japanese captions are delivered as
`EXT-X-MEDIA:TYPE=SUBTITLES` WebVTT segments, and what IMA's ad markup looks
like during a break.

### How to run it

Load `dist/chrome` unpacked in Chrome, enable **Debug mode** in options (this
turns on the `[FlixTranslate:TVer]` log namespace), and open a caption-enabled
episode from a Japanese connection.

Expected log progression:

```text
[FlixTranslate:TVer] adapter started
[FlixTranslate:TVer] content video changed
[FlixTranslate:TVer] media manifest observed
[FlixTranslate:TVer] subtitle segments received
[FlixTranslate:TVer] subtitle cues normalized
[FlixTranslate:TVer] source track ready
```

### Per-episode checklist (repeat on at least 3 programs)

```text
[ ] extension detects TVer
[ ] Japanese subtitle track found
[ ] VTT segments load
[ ] cues are ordered correctly, with no duplicated lines
[ ] translation starts automatically
[ ] translated subtitle timing matches speech
[ ] seek forward works, with no stale line
[ ] seek backward works
[ ] pause/resume works
[ ] playback rates 0.5x / 1.5x / 2x stay in sync
[ ] subtitles remain readable in fullscreen
[ ] TVer's own Japanese captions can coexist without a duplicated source line
[ ] ads show no stale translated dialogue
[ ] translation resumes correctly after ads
[ ] video element replacement does not break subtitles
[ ] SPA episode switch loads the new episode's subtitles
[ ] cached translation loads near-instantly after reload
```

### Edge cases

```text
[ ] episode without TVer captions → "no suitable text subtitle", not a failure
[ ] network briefly offline → bounded retry, then a retryable error
[ ] one subtitle segment unavailable → partial track still renders
[ ] translation API unavailable → graceful failure, playback unaffected
[ ] browser refresh mid-translation → clean restart, no duplicate work
```

### Privacy checks (do these explicitly)

```text
[ ] no signed media URL appears in any console log or the diagnostics panel
[ ] no TVer cookie or authorization header leaves the page realm
[ ] DevTools shows no extension request carrying media URLs off-origin
```

### If discovery fails

Check whether `media manifest observed` ever appears. If it does not, the player
is loading its manifest by a path the agent does not observe, and
`tver-media-agent.ts` needs an additional observation source — not a hard-coded
URL.

---

# Prime Video verification

## Status: DISCOVERY VERIFIED LIVE; END-TO-END RETEST REQUIRED

On 2026-09-12, an authenticated, entitled Chrome playback session confirmed
that the existing page-realm JSON observer receives a subtitle descriptor. The
descriptor's host was `cf-timedtext.aux.pv-cdn.net`; it was rejected by the URL
policy before a playback snapshot could be published. The policy now permits
the `pv-cdn.net` timed-text family. See `PRIME_VIDEO_NOTES.md` for the redacted
structure-only record. Extraction, parsing, translation, rendering, and ad
behaviour still need the checklist below after reloading the rebuilt extension.

### How to run it

Load `dist/chrome` unpacked, enable **Debug mode**, and open a title with
subtitles on `primevideo.com` or an Amazon storefront video page.

Expected log progression:

```text
[FlixTranslate:Prime Video] adapter started
[FlixTranslate:Prime Video] content video changed
[FlixTranslate:Prime Video] playback payload captured
[FlixTranslate:Prime Video] subtitle cues normalized
[FlixTranslate:Prime Video] source track ready
```

**If `playback payload captured` never appears**, first look for
`subtitle-host-rejected <host>`. That means the structural parser did recognise
the descriptor and the allowlist needs a narrowly justified Amazon resource
suffix. If neither log appears, the JSON observer did not see a usable payload;
then widen the interception or matcher based on a structure-only capture, never
a signed URL.

### Checklist (repeat on at least 3 titles, including one series)

```text
[ ] extension detects Prime Video on primevideo.com
[ ] extension detects Prime Video on an amazon.* /gp/video page
[ ] extension stays inactive on the Amazon shop
[ ] subtitle track discovered and translated
[ ] translated subtitle timing matches speech
[ ] seek forward / backward, pause/resume, 0.5x–2x all stay in sync
[ ] subtitles sit on the video in windowed mode, not on the page
[ ] fullscreen remains readable
[ ] cached translation loads quickly after reload
[ ] next-episode autoplay loads the new title's subtitles
[ ] ads show no stale dialogue, and translation resumes afterwards
[ ] a title whose target language Amazon already provides is skipped
[ ] a title with no subtitles reports "no suitable text subtitle"
```

### Privacy checks

```text
[ ] no subtitle URL appears in any console log or the diagnostics panel
[ ] no Amazon cookie accompanies a subtitle download (check request headers)
[ ] no licence, key or protected-media request is made by the extension
```
