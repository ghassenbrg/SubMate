# TVer support — implementation notes

What TVer's production site actually looks like, where it differs from the
assumptions the adapter was designed against, and which behaviour remains
unverified.

## What was inspected

TVer's live production bundle was inspected from a Japanese IP (TVer is
geo-restricted to Japan; requests returned HTTP 200 and were not region-blocked).

### Confirmed

| Fact | Consequence |
| --- | --- |
| TVer is a client-rendered Next.js **static export** (`pageProps` is empty; all episode data loads at runtime) | Nothing useful can be read from server-rendered HTML. Detection and content identity must come from the route and runtime. |
| The video platform is **STREAKS** (`streaksplayer.min.js`, `window.streaksplayer`), **not Brightcove** | The Qiita analysis cited in the spec describes an older stack. Its specifics were treated as a lead only. |
| The player loads **Google IMA** (`imasdk.googleapis.com/js/sdkloader/ima3.js`) | Ads are client-side inserted, normally into their own container and media element — which is what `tver-player.ts` keys on. |
| Episode metadata exposes `episode.id`, **`episode.is_subtitle`**, `episode.ads_enabled`, and `player_metadata.streaks.{project_id, video_ref_id, ovp_player_callback_id}` | An official, stable episode identifier exists, and captions have an explicit availability flag. |
| Player assets are versioned under `player.tver.jp/streaksplayer/{vod,live,short}/` | Player internals are minified and version-dependent, so nothing depends on them. |

### Deliberately not used

TVer's player config (`player.tver.jp/player/streaks_info_v2.json`) is publicly
served and contains **per-broadcaster STREAKS API keys**. SubMate does not
read, store or use them.

Using those keys to mint our own playback sessions would mean the extension
impersonating TVer's player against the STREAKS backend. That is outside the
"only consume what the authorized player already exposes" boundary, so the
adapter instead **observes what the page itself loads** and never authenticates
on its own behalf.

### Not verified

Establishing the exact subtitle delivery shape requires a live, authorized
playback session. That was not achievable here: the available sandbox browser
blocked TVer's own `_next/static` chunks (`ERR_BLOCKED_BY_CLIENT`), so the SPA
never booted, and no ordinary Chrome instance was connected.

**Since confirmed by live use** (episode `epwkvwnxez`, reported by the maintainer):

* Japanese captions **do** arrive as `EXT-X-MEDIA:TYPE=SUBTITLES` WebVTT
  segments, and end-to-end extraction, translation and rendering work.
* Segments **do** carry `X-TIMESTAMP-MAP`, and the stream's presentation clock
  starts at a **non-zero PTS** — see "Presentation-clock origin" below.

**Still unverified:**

* the exact `LANGUAGE` value used (`ja`, `ja-JP` and `jpn` are all accepted);
* the precise DOM/class names IMA renders into during an ad break.

**Nothing in this implementation hard-codes a CDN host, path shape or class
name as its only signal.** Every discovery step has a fallback, and each ad
signal is independent, so a change on TVer's side degrades one path instead of
breaking subtitles outright.

## How subtitle discovery works

```text
page-world agent observes .m3u8 URLs the player requests
   (wrapped fetch + XHR + PerformanceObserver, all non-destructive)
        ↓
newest observed URL that parses as a master playlist
        ↓
EXT-X-MEDIA TYPE=SUBTITLES, Japanese, preferring non-forced + default
        ↓
subtitle media playlist → WebVTT segments (concurrency 6, bounded retries)
        ↓
decoded segment text crosses into the extension world   ← no URL crosses
        ↓
X-TIMESTAMP-MAP / playlist offset → merge → dedupe → normalize
        ↓
existing translation, cache, timeline and overlay
```

### Why the page world does the fetching

The MAIN-world agent holds every media URL and performs every media request, the
same pattern already used for Netflix. Only decoded WebVTT text and a small
track descriptor cross into the extension world. Signed URLs never appear in
messages, logs or diagnostics — error strings are additionally scrubbed of
anything URL-shaped before they leave the page realm.

Segment requests use `credentials: 'same-origin'`, so TVer cookies are never
forwarded to a third-party CDN.

### Browser API wrapping

`fetch` and `XMLHttpRequest.prototype.open` are wrapped only to *record* URLs.
Each wrapper calls the original with the original arguments, returns its value
untouched, swallows its own observation errors, and is restored on `pagehide`
(and only if nothing else re-wrapped it since). TVer playback cannot be broken
by observation failure.

## Presentation-clock origin

`X-TIMESTAMP-MAP` relates a segment's cue clock to the MPEG-2 **presentation
clock (PTS)**, not to player time. A media element's `currentTime` starts at
zero, but a stream's PTS generally does not — TVer's observed stream starts
around 9s (810000 ticks at 90 kHz).

Converting a cue to PTS time without removing that origin shifts the entire
track later by the stream's initial PTS. This showed up in the field as a
caption spoken at 0:16 being written out at 0:25, in the overlay *and* in
exported SRT — the tell that the cue data itself was shifted rather than the
rendering.

The origin is recovered from the earliest segment carrying a map: that segment
begins at its playlist position on the player timeline, so whatever its map adds
beyond that position is exactly the offset the player does not share. Removing
it makes both common segmented-WebVTT conventions land correctly without
detecting which is in use:

| Convention | After removing the origin |
| --- | --- |
| Constant `MPEGTS`, episode-absolute cue clocks | offset collapses to `0` |
| Per-segment `MPEGTS`, segment-local clocks | offset collapses to the segment's playlist position |

`TVER_TIMELINE_VERSION` in `tver-adapter.ts` is part of the track id, so changing
this reconstruction retires previously cached tracks automatically rather than
leaving stale timings on screen.

## Ads

`isAdvertisementPlaying()` combines three independent signals: a rendered ad
container, a player-root ad-state class, and a separate ad media element that is
playing. Any one is sufficient — showing episode dialogue over an advertisement
is a worse failure than briefly withholding subtitles.

While an ad plays, the overlay hides and **stops matching cues entirely**, so the
ad's clock can never be mistaken for episode time. Content resumes against the
content element's own time.

## Known limits

* **Live and "short" content.** The adapter targets VOD episodes. A sliding live
  playlist yields whatever segments exist at request time.
* **Manifest observation is best-effort.** If the player never surfaces a
  manifest to `fetch`, XHR or Resource Timing, discovery waits ~12s and then
  reports a real error rather than hanging in "finding subtitles".
* **Progressive captions.** Extraction reads the whole subtitle playlist up
  front. If TVer serves a partial playlist early in playback, the track reflects
  what the playlist advertised at that moment; a retry re-reads it.
* **`episode.is_subtitle` is not read.** It lives in TVer's React state, and
  reaching into minified internals is exactly the fragility the spec warns
  against. An episode without captions therefore surfaces after discovery, as
  "no suitable text subtitle", not as a failure.
