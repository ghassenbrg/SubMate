# FlixTranslate

**Private, synchronized subtitle translation for Netflix and TVer in Chrome.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

FlixTranslate is an independent Manifest V3 browser extension that translates streaming text subtitles on-device, caches the result locally, and displays it against the original cue timing. It has no FlixTranslate account, backend, analytics, or bundled API key.

Supported platforms are **Netflix** and **TVer**, each implemented as a platform adapter over a shared translation, caching, synchronization and rendering core. See [Architecture](docs/ARCHITECTURE.md).

> FlixTranslate is not affiliated with, endorsed by, or sponsored by Netflix or TVer.

## Highlights

- Translates supported subtitle language pairs with Chrome's on-device Translator API; subtitle text stays in the browser.
- Reads TTML/DFXP and WebVTT subtitle tracks, preserves timing, and supports bilingual, translation-only, and off display modes.
- Caches source subtitles and translations in IndexedDB for fast recovery after reloads and episode changes.
- Provides synchronized, fullscreen-aware, direction-aware overlays with adjustable appearance controls.
- Supports import/export in FlixTranslate JSON, SRT, and VTT with alignment validation.
- Ships English, Japanese, Arabic (including RTL), and French interface localizations.
- Extracts Japanese captions from TVer's segmented HLS WebVTT, merging and de-duplicating them into one episode track.
- Hides translated subtitles during TVer advertisements and resynchronizes against content time afterwards.
- Uses narrowly scoped Netflix and TVer host permissions, never `<all_urls>`, and has no telemetry or FlixTranslate-operated server.

## Demo

1. Open a Netflix title with text subtitles, or a caption-enabled TVer episode.
2. Choose a target language in the FlixTranslate popup.
3. Start translation from the popup or in-player controls. Chrome downloads language data if needed, then FlixTranslate renders synchronized translated subtitles.

For a live testing checklist and expected states, see [Manual testing](docs/MANUAL_TESTING.md). Screenshots of live Netflix playback are intentionally not committed because they can expose account, title, and regional catalog information; contributions may include sanitized UI screenshots that follow the [contribution guide](CONTRIBUTING.md).

## Install

### Chrome (unpacked build)

1. Download and extract the Chrome ZIP from the relevant [GitHub Release](https://github.com/ghassenbrg/FlixTranslate/releases), or build it locally as described below.
2. In Chrome, open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked**, then choose the extracted extension directory. For a local build, that directory is `dist/chrome/`.
4. Pin FlixTranslate, open Netflix or TVer, then choose a target language from the popup.

The packaged ZIP contains the extension files at its root. Extract it before using **Load unpacked**; it is also the file submitted to the Chrome Web Store.

## Supported browsers and platforms

FlixTranslate currently targets **Google Chrome 138 or later on desktop** (macOS, Windows, and Linux). The availability of particular language pairs and the initial language-model download are determined at runtime by Chrome's Translator API. A current Netflix subscription and text-based subtitle track are required.

Firefox, Safari, mobile Chrome, and Edge are not currently supported release targets. The build layout is prepared for future browser targets under `dist/`.

## Development

### Prerequisites

- Node.js 20 or later (Node 22 is used in CI)
- npm 10 or later
- Google Chrome 138 or later for manual extension testing

### Setup

```sh
git clone https://github.com/ghassenbrg/FlixTranslate.git
cd FlixTranslate
npm ci
```

### Validate, build, and package

```sh
# Type-check and run the test suite
npm run check
npm test

# Create a production Chrome build
npm run build:chrome

# Confirm the built manifest and required files are release-safe
npm run validate:chrome

# Build, validate, and create a Chrome Web Store-ready ZIP
npm run pack:chrome
```

`npm run validate` runs the full local gate. Production files are written to `dist/chrome/`; release ZIPs are written to `dist/packages/`.

To test the production build, load `dist/chrome/` through `chrome://extensions`, then follow [Manual testing](docs/MANUAL_TESTING.md).

## Usage

On a Netflix playback page, choose the target language in the extension popup and select **Start translation**. If the target subtitles are already supplied by Netflix, FlixTranslate will not duplicate them. Choose bilingual, translation-only, or off from the popup or in-player controls. The options page provides source-language preferences, appearance settings, cache management, and import/export controls.

Automatic translation only works for text subtitle tracks and language pairs available through Chrome. For unsupported pairs or manual workflows, export a translation package and import a matching completed translation.

## Project structure

```text
public/       Manifest, HTML, localization files, CSS, and icons
src/          Extension source code
  background/ Service worker
  content/    Platform-independent content-script orchestration
  platforms/  Netflix and TVer adapters plus the adapter registry
  core/       HLS parsing, segment merging, playback observation, retry
  page/       Page-realm media/manifest agents
  subtitles/  Parsers, normalization, validation, and timing
  translation/ Translator provider and translation manager
  ui/         Popup and options interfaces
scripts/      Build, validation, packaging, and tag checks
tests/        Unit, integration, fixture, and UI-harness tests
docs/         User, technical, testing, and publishing documentation
.github/      CI/release workflow and contribution templates
```

## Releases and publishing

Releases are versioned with a matching package and manifest version, then tagged as `vX.Y.Z`. Pushing that tag runs type checks and tests, builds and validates `dist/chrome/`, creates a ZIP, uploads it to a GitHub Release, and can optionally upload it to the Chrome Web Store.

Read the step-by-step [publishing guide](docs/PUBLISHING.md) before cutting a release. The initial Chrome Web Store listing must be completed manually; later updates can be automated once the required repository secrets and variables are configured.

## Contributing, support, and security

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) for the development and review process. Use the provided GitHub issue templates for bugs and feature requests; for general help, see [SUPPORT.md](SUPPORT.md).

Please report potential vulnerabilities privately as described in [SECURITY.md](SECURITY.md), rather than opening a public issue.

## License

FlixTranslate is released under the [MIT License](LICENSE).

## Technical inspiration

Netflix subtitle extraction and secondary-subtitle behavior were researched with reference to [gmertes/NflxMultiSubs](https://github.com/gmertes/NflxMultiSubs), an MIT-licensed project by Dan Chen and Gert Mertes. FlixTranslate is a new, independent implementation; no source code from that project is bundled.
