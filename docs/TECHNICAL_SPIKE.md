# Technical spike results

Date: 2026-09-08

## Netflix manifest capture

The current `gmertes/NflxMultiSubs` default branch was inspected at commit
`9d96a300fac24eb8d500e9a5d6fe279686f875a7` (2026-06-12). Its current Chrome
implementation still patches `JSON.parse` at `document_start`, looks for
`result.result.movieId`, accepts both `textTracks` / `timedtexttracks` and
`downloadables` / `ttDownloadables`, and prefers the `dfxp-ls-sdh` text profile.

FlixTranslate implements that current behavior without copying the reference
source. It also observes `Response.json`, tolerates current/legacy field names,
handles hydrated manifest updates, tracks SPA navigation, rejects preload
manifests whose content ID does not match `/watch/<id>`, and sends only a
bounded `NetflixManifestSnapshot` through the page bridge.

Every subtitle URL is reduced to HTTPS Netflix-owned resource suffixes and kept
inside the page-realm agent. The isolated extension requests only a previously
captured content/track/profile tuple; Netflix's own page realm downloads the
bounded text and returns data, never a privileged fetch instruction. Raw
manifests and URLs never cross into privileged extension code.

Authenticated live Netflix validation was performed in desktop Chrome
152.0.7977.76 on `https://www.netflix.com/watch/83068200?trackId=253628477`.
The early page hook captured the current episode, selected the regular Japanese
text track instead of its forced-narrative alternative, downloaded and parsed
521 cues, and reached a Ready Japanese → American English translation state.
The live overlay root reported one time-matched cue while Netflix displayed a
Japanese native cue. This proves the current manifest, download, parser,
Translator, and time-index paths on this title/account session.

The first live rendering attempt also exposed a real defect: the overlay's
show path cleared the inline `display` value, causing the stylesheet's
`display:none` default to keep winning. The renderer now explicitly sets
`display:block`; a synthetic regression test verifies translated text and the
diagnostic visibility flag. Chrome still has the earlier unpacked bundle loaded,
so that final fix requires clicking **Reload** for FlixTranslate on
`chrome://extensions` before its live visual result can be claimed.

Autoplay subsequently moved the same live tab to content `83068201`. The old
overlay was cleared and no duplicate root remained, but the loaded bundle was
left in Discovering. Netflix had delivered the next manifest as a preload while
the previous `/watch/83068200` route was current; the isolated orchestrator
correctly rejected it then, but the page agent did not replay it after route
navigation. The page agent now retains only the eight most recent private
manifest records and republishes the matching URL-redacted snapshot after the
new content ID becomes current. This transition is covered by unit regressions
but awaits the same unpacked-extension reload for live confirmation.

The following remain external checks rather than claims:

- the fixed overlay after the unpacked-extension reload;
- exact text profiles and CDN behavior across representative titles/regions;
- active source-track changes and live confirmation of the fixed next-episode replay;
- fullscreen, resize, playback-rate, and current native-subtitle collision tests;
- cache reuse after a reload and the complete manual import workflow.

## Chrome Translator execution context

Official Chrome documentation was rechecked on 2026-09-08. It documents the
desktop Translator API in Chrome 138+, `Translator.availability()`, user
activation for `Translator.create()`, model download monitoring, BCP-47
language identifiers, sequential translation behavior, and unavailability in
Web Workers.

The published implementation list currently includes `ja`, `ar`, and `fr` (as
well as the other suggestions shown by FlixTranslate), while warning that the
list may change. FlixTranslate therefore keeps the picker descriptive and calls
`Translator.availability()` for the actual source/target pair:
https://developer.chrome.com/docs/ai/translator-api#supported-languages

The implementation therefore keeps `Translator` in the isolated Netflix
content-script document, never in the service worker. `create()` is invoked as
the first operation in the in-player/popup click handler. A successfully
created session is retained for later episodes using the same pair in the same
page, while new pairs and full reloads explicitly return to the activation
state. Model download and per-cue episode progress are separate states.

Synthetic Chrome Translator tests cover feature detection, arbitrary BCP-47
pairs, creation, download progress, full cue-ID preservation, and destruction.
Actual Japanese → American English production preparation reached Ready for
all 521 cues in the authenticated player. Model availability for other language
pairs, first-download progress, activation persistence after a full reload, and
pair switching remain browser-managed constraints to verify dynamically; the
extension does not infer support from its language picker.

## Decision

No FlixTranslate backend is justified. The service worker owns only durable
extension-origin IndexedDB/cache coordination. Translation stays in a document
context; Netflix-specific extraction stays isolated from translation, storage,
and rendering.
