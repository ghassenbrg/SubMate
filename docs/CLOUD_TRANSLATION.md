# Cloud translation (optional)

SubMate translates on-device by default. A cloud engine is available as an
opt-in alternative for higher-quality, context-aware translation.

**It is off unless you turn it on, and it changes the privacy properties of the
extension.** On-device translation never leaves the browser. Cloud translation
sends subtitle text to the provider you select.

## What is and is not sent

Sent: the subtitle text of the current episode, the source and target language,
and a few preceding lines as continuity context.

Never sent: cookies, authorization headers, signed media URLs, video, audio,
the page URL, the title you are watching, or any browsing data. The request
carries subtitle text and language tags — nothing that identifies the title.

There is still no SubMate backend. Your key talks to your provider
directly; nothing is proxied through a server we operate.

## Setting it up

1. Options → Translation → Engine → **Cloud API**
2. Paste your API key and, optionally, a model name.

The key is stored with `chrome.storage.local` on this device only. It is
deliberately **not** part of the settings object and **not** stored in
`chrome.storage.sync`, so it is never replicated to your other devices.

Only the background service worker ever reads it. The content script — the part
that runs alongside Netflix, TVer and Prime Video — never receives it, and the
options page never renders a saved key back into the DOM; it only reports
whether one exists.

## How translation is batched

Cue-by-cue translation would mean hundreds of API calls per episode. Instead
cues are batched (60 cues / 6 000 characters) and sent as one id-keyed JSON
object, with the tail of the previous batch passed as context so names, pronouns
and register stay consistent across an episode. That context is the main quality
advantage over the on-device engine.

Each batch is one message to the service worker. MV3 workers are terminated when
idle, so keeping batches independent means a shutdown costs one batch rather
than the episode.

## Handling imperfect model output

Models drop lines, merge two subtitles into one, renumber, invent ids, and wrap
JSON in markdown fences. The pipeline assumes all of it:

* responses are unwrapped from fences and surrounding prose;
* both the object form and the array-of-objects form are accepted;
* results are matched **by cue id only** — response order is never used to
  realign, since a single dropped line would otherwise shift every later
  subtitle onto the wrong cue;
* ids that were not requested are discarded;
* missing ids trigger one targeted repair request for just those lines;
* anything still missing is returned blank, and the renderer falls back to the
  original text for blank lines, so a gap never appears on screen.

Because every requested id is always present in the result, the existing
validation stays exact rather than being loosened for the cloud path.

## Cost and caching

Translations are cached per episode, keyed by
`sourceHash | targetLanguage | engineId | engineVersion`. The vendor is part of
the engine id and the model is the engine version, so:

* re-watching an episode costs nothing;
* switching vendor or model correctly re-translates instead of serving output
  from a different model;
* on-device and cloud translations of the same episode coexist.

## Errors

Failures surface with the provider's status code. A missing key reports a setup
problem rather than an unsupported language pair. Rate limits (429) and server
faults are retried with backoff; a bad key or model is not, because it will fail
identically every time.

API keys are redacted from every error path — exact key match, key-shaped
tokens, and `key=` query parameters — before a message can reach a log, the
diagnostics panel or the UI.

## Adding another provider

`src/translation/cloud/vendor.ts` defines the interface; `gemini.ts` implements
it. A new provider is a new file plus a registry entry, exactly as a new
streaming service is a new platform adapter. The batching, reconciliation,
caching and error handling are shared.
