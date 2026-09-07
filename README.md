# FlixTranslate

FlixTranslate is an independent Manifest V3 Chrome extension that translates
available Netflix text subtitles into a user-selected language, caches the
result locally, and renders it against Netflix's original cue timing.

It is not affiliated with or endorsed by Netflix.

## MVP features

- Early, page-realm Netflix manifest observation with a strictly validated bridge
- Language-agnostic BCP-47 source/target handling
- TTML/DFXP and WebVTT parsing, normalized cue IDs, and SHA-256 source hashes
- Chrome's on-device Translator API with activation/download/progress UX
- IndexedDB source and translation cache keyed by subtitle content and engine version
- Full-episode translation with cancellation across Netflix SPA navigation
- Synchronized, fullscreen-capable, direction-aware subtitle overlay
- Translation-only and bilingual display modes
- FlixTranslate JSON, SRT, and VTT export/import with strict alignment validation
- Accessible popup, onboarding, in-player status/control, appearance settings, and cache tools
- No FlixTranslate backend, account, analytics, or packaged API secret

## Develop

```sh
npm install
npm test
npm run build
```

Load `dist/` from `chrome://extensions` using **Load unpacked**. Chrome 138+
on desktop is required for the on-device Translator API.

See [docs/MANUAL_TESTING.md](docs/MANUAL_TESTING.md) for authenticated Netflix
and Translator API verification. See [docs/MVP_AUDIT.md](docs/MVP_AUDIT.md) for
the specification audit and external constraints.

The interface ships in English, Japanese, Arabic, and French, with full RTL
handling. See [docs/LOCALIZATION.md](docs/LOCALIZATION.md) to add another UI
locale or suggested translation target.

## Privacy and security

On-device translation is performed by Chrome's browser-managed local model.
FlixTranslate does not operate a backend and does not transmit subtitle text or
collect telemetry. Manual exports leave the extension only when the user chooses
to download them. Page-realm messages are treated as untrusted data, executable
HTML is never rendered, and subtitle downloads are restricted to HTTPS Netflix
resource hosts.

## Technical inspiration

Netflix subtitle extraction and secondary-subtitle behavior were researched
with reference to [gmertes/NflxMultiSubs](https://github.com/gmertes/NflxMultiSubs),
an MIT-licensed project by Dan Chen and Gert Mertes. FlixTranslate is a new,
independent implementation; no source code from that project is bundled.
