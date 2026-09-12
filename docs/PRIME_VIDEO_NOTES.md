# Prime Video support — implementation notes

## Status: IMPLEMENTED, DISCOVERY VERIFIED LIVE

The adapter is covered by automated tests. Subtitle discovery was verified
against an authenticated, entitled Chrome playback session on 2026-09-12; the
full extraction, parsing, translation and rendering checklist still needs a
post-fix run.

## What was inspected

`primevideo.com` and `amazon.co.jp/gp/video` were fetched from a Japanese IP
(both HTTP 200). Confirmed from the live storefront:

| Fact | Consequence |
| --- | --- |
| Prime Video is server-rendered, with bundles on `m.media-amazon.com` | Detection cannot rely on a client-side app shell the way TVer's does. |
| The playback service is `atv-ps-fe.primevideo.com` | Playback resolution happens through Amazon's own service, which is what the page-realm agent observes. |
| Prime Video is served both from `primevideo.com` and from regional `amazon.*` storefronts | Hostname alone is unsafe: matching `amazon.com` would put this extension on the entire shop. Amazon matches are path-scoped to `/gp/video/*`. |

## Live discovery finding — 2026-09-12

An authorized Prime Video playback session reached the existing JSON observer.
The captured object contained a timed-text descriptor with a recognised URL
field, a recognised language field, and an HTTPS host below `pv-cdn.net`
(observed host: `cf-timedtext.aux.pv-cdn.net`). Its nesting and the exact key
spellings were deliberately not logged, and no signed URL, token, cookie, path,
or query string was retained.

The structural matcher therefore already recognised the payload; discovery
failed because `prime-url-policy.ts` rejected the timed-text host family. The
policy now accepts the Amazon Prime timed-text suffix dynamically, with a
redacted regression fixture. No DRM path, credentials, request headers, or
extension permissions changed.

**Still not verified:** the exact descriptor key spelling/nesting and whether
the document is TTML/DFXP or WebVTT in this rollout. Those details are not
needed for safe discovery and were not recorded.

## Why the parser is structural rather than path-based

Because that shape is unverified, `prime-manifest.ts` **walks** the payload
instead of reading a fixed path. A descriptor counts as a subtitle track only
when it carries both an Amazon-hosted URL and a language tag, and several key
spellings are accepted (`url`/`uri`/`subtitleUrl`/`src`,
`languageCode`/`language`/`bcp47`/`locale`).

This mirrors the existing Netflix parser, which already tolerates
`movieId`/`movie_id` and `textTracks`/`timedtexttracks`. A rigid path would fail
silently the first time Amazon renamed anything.

Traversal is bounded — depth 12, 20 000 nodes, 80 tracks, 200 entries per
array — so a large or hostile payload cannot hang the page.

## DRM boundary

**Nothing here touches DRM.** Prime Video protects its video stream with
Widevine; subtitles are separate sidecar timed-text documents that the playback
payload points the player at. The adapter reads only those documents. No licence
request, key exchange, manifest decryption or protected-media access is
involved, and none would be added to make this work.

Subtitle downloads use `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`,
so no Amazon cookie accompanies them. URLs are additionally restricted to
Amazon-owned hosts (`primevideo.com`, `media-amazon.com`, `aiv-cdn.net`,
`amazonvideo.com`, regional `amazon.*`), so a tampered payload cannot steer the
extension at an unrelated origin.

As with Netflix and TVer, subtitle URLs never leave the page realm: the snapshot
that crosses into the extension world has its URLs stripped, tracks are
requested **by language**, and error strings are scrubbed of anything
URL-shaped.

## Content identity

The title is identified by its Amazon ASIN/GTI, taken from the route
(`/detail/<id>`, `/gp/video/detail/<id>`, `/dp/<id>`, or an `asin`/`gti`/`titleId`
query parameter) and corroborated by the payload's `catalogMetadata.catalog.id`.
A signed subtitle URL is never used as identity, since those rotate per session.

Prime resolves playback for recommendations and next-episode preloads too, so a
payload whose title differs from the current route is ignored — the same guard
Netflix needs for hover previews.

## Ads

Prime Video now carries advertising. Ad detection uses the shared
`core/playback/ad-signals` detector with Prime's selectors, keyed primarily on
the player's own `atvwebplayersdk-` namespace, with broader patterns alongside
so detection degrades rather than disappears if that prefix changes.

The selectors themselves are the least-verified part of this adapter.

## Adding more Amazon storefronts

Only `primevideo.com`, `amazon.co.jp/gp/video` and `amazon.com/gp/video` are
declared today, to keep the permission surface small. Another storefront is a
one-line addition to `host_permissions` and the two Prime `content_scripts`
entries in `public/manifest.json` — no code change.
