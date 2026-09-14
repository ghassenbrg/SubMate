# Chrome Web Store listing draft

Use this draft when creating the first SubMate item in the Chrome Web Store
Developer Dashboard. It is intentionally ready to copy, but it does not
replace reviewing the current dashboard fields and policies before submission.

## Identity

| Field | Draft value |
| --- | --- |
| Name | SubMate: Subtitle Translator |
| Category | Productivity |
| Language | English |
| Support URL | https://github.com/ghassenbrg/SubMate/issues |
| Privacy-policy URL | https://submate.ghassen.io/privacy.html |
| Website | https://submate.ghassen.io/ |

Before saving the listing, add the maintainer's support email in the dashboard.
Do not use an address that is not monitored for user support or policy notices.

## Short description

Translate supported Netflix, TVer, and Prime Video text subtitles in Chrome.

## Detailed description

SubMate adds synchronized translated subtitles to supported Netflix, TVer, and
Prime Video titles in desktop Google Chrome. Choose bilingual subtitles,
translation only, or turn the overlay off at any time.

By default, SubMate uses Chrome's on-device Translator API when a language pair
is available, keeping subtitle text in the browser. It stores settings,
subtitle sources, and translations locally to restore playback promptly.

For language pairs or output quality beyond Chrome's on-device support, you can
optionally configure a cloud translation provider with your own API key.
SubMate sends subtitle text, language tags, and a small amount of preceding
subtitle context directly to the provider you choose. Cloud translation is off
by default; SubMate has no account system, analytics, backend, or bundled API
key.

SubMate requires a desktop Chrome version supported by the extension and a
title with a text subtitle track. Streaming-service access, title availability,
captions, and supported language pairs vary by region.

SubMate is independent and is not affiliated with, endorsed by, or sponsored
by Netflix, TVer, Amazon, or any cloud translation provider.

## Privacy and permission review notes

Review these statements against the dashboard's current questions before each
submission; do not treat this draft as a substitute for the form.

- The extension has no SubMate account, backend, analytics, or bundled key.
- `storage` stores settings, subtitle sources, translations, and any
  user-provided cloud-provider key locally in Chrome.
- Streaming host access is limited to Netflix, TVer, Prime Video, and the
  declared Amazon Video paths so SubMate can read text subtitle tracks and
  render the overlay on those pages.
- Provider-host access is optional and requested only when a user chooses a
  cloud provider or custom endpoint. In that mode, subtitle text, language
  information, and limited preceding subtitle context are sent directly to that
  selected provider.
- The extension does not send cookies, authorization headers, signed media
  URLs, video, audio, title names, page URLs, or browsing history to cloud
  translation providers.

The dashboard's data-use declaration must be answered truthfully from the
release being uploaded. In particular, disclose any handling of website content
that the dashboard defines to include subtitle text; mark no data category as
handled unless the current behavior supports that answer.

## Ready-to-upload Store assets

The following files are sized for the current dashboard requirements and are
safe to upload with the `0.1.1` package:

| Dashboard field | File | Dimensions |
| --- | --- | --- |
| Store icon | `public/icons/icon-128.png` | 128×128 PNG |
| Screenshot | `docs/chrome-web-store/settings-screenshot-v2.png` | 1280×800 PNG |
| Small promo tile | `docs/chrome-web-store/small-promo-v1.png` | 440×280 PNG |

The screenshot shows the Options page's language and on-device translation
controls. The promotional tile is text-free and uses the extension's navy,
cyan, and blue visual language. A marquee image is optional; do not add one
unless it is needed for a specific Store feature.

Before adding more screenshots, remove account names, email addresses,
title-specific viewing data, API keys, and copyrighted subtitle text.

## Dashboard privacy and permission answers

Use the current upload, not this document alone, as the source of truth.

- **Single purpose:** Translate text subtitles on supported Netflix, TVer, and
  Prime Video pages and display the translation in sync with playback.
- **`storage` permission:** Store settings, locally cached subtitle sources and
  translations, and user-provided cloud-provider credentials in Chrome.
- **Streaming-site host access:** Read text subtitle tracks and render the
  subtitle overlay on the supported sites only.
- **Optional provider-host access:** Requested only after a user selects a
  cloud translation provider or custom endpoint; used to send subtitle text,
  language information, and limited preceding subtitle context directly to
  that provider.
- **Data use:** No SubMate account, backend, analytics, bundled API key,
  cookies, authorization headers, signed media URLs, video, audio, title name,
  page URL, or browsing history is transmitted. The dashboard declaration must
  still disclose subtitle text if its current definition categorizes that as
  website content.

## After the first item is created

Record the Store Item ID and Publisher ID in a password manager or other secure
maintainer record. Add only the IDs as GitHub repository variables; keep OAuth
client credentials and the refresh token in the `chrome-web-store` environment
secrets. Leave `CHROME_WEB_STORE_PUBLISH` unset until the listing, assets,
privacy answers, and first manual submission are complete.
