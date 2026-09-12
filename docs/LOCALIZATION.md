# SubMate localization

SubMate uses Chrome's native extension localization system. English is the fallback locale; Japanese, Arabic, and French ship with the MVP.

## Add a UI locale

1. Copy `public/_locales/en/messages.json` to `public/_locales/<locale>/messages.json` using a Chrome-supported locale directory name.
2. Translate every `message` value without changing its key or numbered substitutions such as `$1`.
3. Run `npm test`. The locale parity test fails when a catalog has missing, extra, or empty messages.
4. Run `npm run build:chrome`. The complete `_locales` tree is copied into
   `dist/chrome/`.
5. Test the popup, options page, and player overlay with Chrome set to that UI locale. RTL locales are detected centrally by `src/i18n/index.ts`.

All runtime UI should call `t('messageKey')` from `src/i18n/index.ts`. Add the English fallback and the same key to every locale catalog when introducing new copy. Do not hardcode user-facing text inside components.

## Add a translation target suggestion

Add its BCP-47 code and English fallback name to `LANGUAGE_SUGGESTIONS` in `src/ui/shared/languages.ts`. Visible language names come from `Intl.DisplayNames`, so they follow the user's UI language. Suggestions do not restrict capability: users can enter any valid custom BCP-47 tag, and Chrome's Translator API checks the source/target pair dynamically.

The initial suggestions follow Chrome's published desktop Translator language
list, which currently includes Japanese, Arabic, and French. Chrome explicitly
notes that this implementation list can change, so runtime
`Translator.availability()` remains authoritative:
https://developer.chrome.com/docs/ai/translator-api#supported-languages

Japanese (`ja`), Arabic (`ar`), and French (`fr`) are pinned at the top of language selectors for easy discovery. This is presentation only and never changes translation logic.
