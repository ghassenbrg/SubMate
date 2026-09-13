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

## Assets to capture before creating the item

Capture real, reviewable product screens from the production build rather than
mock-ups. Follow the dashboard's current image dimensions and count limits.

1. A supported title with the bilingual subtitle overlay visible.
2. The popup showing source/target language selection and translation mode.
3. The Options page showing appearance controls.
4. The Options page showing the opt-in cloud translation privacy warning, with
   no API key or personal viewing data visible.
5. A promotional tile or marquee image only if the dashboard requires it.

Before uploading, remove account names, email addresses, title-specific
viewing data, API keys, and copyrighted subtitle text from all images.

## After the first item is created

Record the Store Item ID and Publisher ID in a password manager or other secure
maintainer record. Add only the IDs as GitHub repository variables; keep OAuth
client credentials and the refresh token in the `chrome-web-store` environment
secrets. Leave `CHROME_WEB_STORE_PUBLISH` unset until the listing, assets,
privacy answers, and first manual submission are complete.
