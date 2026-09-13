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

## Providers

Every provider is reached through the OpenAI-compatible Chat Completions API,
so one client covers all of them:

| Provider | Default model | Key |
| --- | --- | --- |
| Google Gemini | `gemini-3.5-flash-lite` | [AI Studio](https://aistudio.google.com/apikey) |
| OpenAI (ChatGPT) | `gpt-5.6-luna` | [OpenAI platform](https://platform.openai.com/api-keys) |
| Anthropic (Claude) | `claude-haiku-4-5` | [Claude console](https://platform.claude.com/settings/keys) |
| Mistral AI | `mistral-small-latest` | [Mistral console](https://console.mistral.ai/api-keys) |
| DeepSeek | `deepseek-flash` | [DeepSeek platform](https://platform.deepseek.com/api_keys) |
| xAI (Grok) | `grok-4.6` | [xAI console](https://console.x.ai) |
| Groq | `openai/gpt-oss-20b` | [Groq console](https://console.groq.com/keys) |
| OpenRouter | `openrouter/auto` | [OpenRouter](https://openrouter.ai/settings/keys) |
| **Custom** | you name it | optional |

**Custom** is for anything else that speaks the protocol: Ollama, LM Studio,
vLLM, LiteLLM, a company gateway. Give it a base URL (for example
`http://localhost:11434/v1`) and a model name. HTTPS is required, except for a
server on `localhost` / `127.0.0.1`, so a key is never sent in the clear.

Ollama rejects requests from browser extensions unless it is told to accept
them: start it with `OLLAMA_ORIGINS=chrome-extension://*`.

Default models go stale — `gemini-2.0-flash` was shut down in June 2026 — so the
model field also suggests whatever the provider's `/models` endpoint currently
lists.

## Setting it up

1. Options → Translation → Engine → **Cloud API**
2. Pick a provider, or paste a key: keys with a recognizable prefix (`AIza`,
   `sk-ant-`, `sk-or-`, `sk-proj-`, `gsk_`, `xai-`) select their provider.
3. Allow access when Chrome asks. SubMate requests access to that one host only.
4. Optionally name a model; blank uses the provider's default.

### Keys

Keys are stored with `chrome.storage.local` on this device only, one per
provider, so switching providers never sends one provider's key to another. They
are deliberately **not** part of the settings object and **not** stored in
`chrome.storage.sync`, so they are never replicated to your other devices.

Only the background service worker ever reads them to make requests. The content
script — the part that runs alongside Netflix, TVer and Prime Video — never
receives a key, and cannot choose where one is sent: the worker takes the
provider, endpoint and model from storage, never from the content script's
message. The options page never renders a saved key back into the DOM; it only
reports whether one exists.

### Host permissions

No provider host is granted at install. The manifest declares HTTPS and
localhost as `optional_host_permissions`, and the options page asks for the
chosen provider's host at the moment you pick it. Without that grant the worker
refuses to send anything and the player says so.

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

A model can also return well-formed JSON that is simply the input handed back.
Lines whose "translation" equals the source (ignoring lines with no letters, such
as music notes) are retried with the dropped ones; if most of a batch is still
untranslated, the batch fails with a "try a different model" message instead of
being cached, and any leftover echo is blanked so it is not shown twice. The
prompt names both languages in full ("Japanese (ja)" → "Arabic (ar)"), since a
bare code is the most common reason a model hands the input back.

Because every requested id is always present in the result, the existing
validation stays exact rather than being loosened for the cloud path.

## Checking a provider against the live API

```bash
SUBMATE_API_KEY=... npm run smoke:cloud -- gemini '' ja ar
```

Arguments are provider, model (blank for the default), source, target and — for
`custom` — the base URL. It sends one small batch and prints the raw response and
how each line was reconciled.

## Cost and caching

Translations are cached per episode, keyed by
`sourceHash | targetLanguage | engineId | engineVersion`. The provider is part of
the engine id, and the model plus the prompt revision is the engine version
(with the host, for a custom endpoint), so:

* re-watching an episode costs nothing;
* switching provider or model correctly re-translates instead of serving output
  from a different model;
* on-device and cloud translations of the same episode coexist.

## Errors

Incomplete setup (no key, no base URL, no host permission) reports a setup
problem rather than an unsupported language pair. A rejected key, an unknown
model or endpoint (404), an exhausted quota (429), a missing permission and an
unreachable server each get their own message telling the user what to fix; the provider's status and body
are kept, redacted, for the debug log. Rate limits (429) and server
faults are retried with backoff; a bad key or model is not, because it will fail
identically every time.

API keys are redacted from every error path — exact key match, key-shaped
tokens, and `key=` query parameters — before a message can reach a log, the
diagnostics panel or the UI.

## Adding another provider

If it speaks the OpenAI-compatible API, a provider is one entry in
`src/translation/cloud/providers.ts`: base URL, default model, key prefix and any
request quirks (`jsonMode`, extra headers or body fields). The client, batching,
reconciliation, caching and error handling are shared.
