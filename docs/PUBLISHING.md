# Publishing SubMate

This guide is the concise release runbook for SubMate. It covers the GitHub
release artifact and optional Chrome Web Store update path. Follow it from a
clean, reviewed `main` branch. For the complete first-time setup—including
accounts, OAuth credentials, GitHub secrets, Pages, and the custom domain—read
the repository [HOWTO](../HOWTO.md) first.

## Release model

SubMate uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html):

- **Patch** (`0.1.1`): backwards-compatible bug fixes.
- **Minor** (`0.2.0`): backwards-compatible functionality.
- **Major** (`1.0.0`): breaking behavior, support, or configuration changes.

The version in `package.json` and `public/manifest.json` must be identical. A
release tag must be exactly `v` followed by that version (for example,
`v0.1.0`). The build validator and workflow enforce both conditions.

## Prepare a release

1. Start from an up-to-date `main` branch with no uncommitted release changes.
2. Choose the next semantic version.
3. Update the `version` field in both `package.json` and `public/manifest.json`.
4. Add user-facing notes under a new version heading in `CHANGELOG.md`.
5. Review the manifest permission changes, if any. A permission increase may
   need an explicit Chrome Web Store review.
6. Run the local release gate:

   ```sh
   npm ci
   npm run validate
   npm run pack:chrome
   ```

7. Install `dist/chrome/` in `chrome://extensions` with **Load unpacked** and
   run the relevant production cases in [MANUAL_TESTING.md](MANUAL_TESTING.md).
   In particular, confirm a real text subtitle track, a supported translation
   pair, playback synchronization, reload recovery, fullscreen, and a failure
   state. Do not use a fixture-only pass as proof of live Netflix behavior.
8. Inspect the package with:

   ```sh
   unzip -l dist/packages/submate-chrome-vX.Y.Z.zip
   ```

   `manifest.json` must be at the ZIP root, not inside a `dist/chrome/`
   directory. The ZIP must contain no source maps or private files.
9. Commit the version, changelog, and release changes; open and merge the
   release pull request.

## Build outputs

```text
dist/
├── chrome/                       # unpacked production extension
└── packages/
    └── submate-chrome-vX.Y.Z.zip
```

`npm run build` is an alias for `npm run build:chrome`. Future targets should
get their own target configuration and output directory (such as
`dist/firefox/`) rather than sharing Chrome's output.

## Create the tag and GitHub Release

After the release commit is on `main`, create and push an annotated tag:

```sh
git tag -a vX.Y.Z -m "SubMate vX.Y.Z"
git push origin vX.Y.Z
```

The **Release extension** workflow then:

1. checks out the tag and installs dependencies with `npm ci`;
2. verifies the tag, `package.json`, and manifest versions agree;
3. type-checks and runs all tests;
4. builds `dist/chrome/`, validates the manifest and required files, and makes
   the release ZIP;
5. retains the ZIP as a workflow artifact for 30 days; and
6. creates a GitHub Release with generated notes, or replaces the ZIP on an
   existing GitHub Release with the same tag.

To re-run an existing release, use **Run workflow** in GitHub Actions and enter
the existing tag. The workflow checks out that exact tag; it does not release
whatever happens to be on the default branch.

## Chrome Web Store setup

The first store submission must be completed in the Chrome Web Store Developer
Dashboard. Create the item and finish its Store listing and Privacy sections,
including the required listing assets and disclosures. Chrome requires two-step
verification for publishers. Follow Google's current [Chrome Web Store API
guide](https://developer.chrome.com/docs/webstore/using-api) when creating the
Cloud project and OAuth credentials.

For automated updates, create a GitHub Environment named `chrome-web-store` and
add these **environment secrets**:

| Secret | Purpose |
| --- | --- |
| `CHROME_WEB_STORE_CLIENT_ID` | OAuth 2.0 client ID with Chrome Web Store API access |
| `CHROME_WEB_STORE_CLIENT_SECRET` | OAuth 2.0 client secret |
| `CHROME_WEB_STORE_REFRESH_TOKEN` | Refresh token authorized with the `https://www.googleapis.com/auth/chromewebstore` scope |

Add these **repository variables** (they are identifiers, not credentials):

| Variable | Value |
| --- | --- |
| `CHROME_WEB_STORE_PUBLISH` | `true` to enable the store job; leave unset or any other value to skip it |
| `CHROME_WEB_STORE_PUBLISHER_ID` | Publisher ID from the Chrome Web Store Developer Dashboard |
| `CHROME_WEB_STORE_EXTENSION_ID` | The existing Chrome Web Store item ID |

Once configured, the workflow's `chrome-web-store` job exchanges the refresh
token for a short-lived access token, uploads the generated ZIP through the
Chrome Web Store API v2, and submits it for publishing. The store's review and
visibility rules still apply; a successful upload is not a guarantee of
immediate public availability.

Keep the publish variable disabled until the first item is manually created and
its dashboard configuration is complete. This prevents a source release from
failing merely because a store listing has not been set up yet.

## Publish manually to the Chrome Web Store

If automation is disabled or a manual review is preferred:

1. Run `npm run pack:chrome` from the reviewed release commit.
2. Open the Chrome Web Store Developer Dashboard and select the item.
3. Upload `dist/packages/submate-chrome-vX.Y.Z.zip`.
4. Verify the manifest version, permission disclosures, privacy disclosure,
   screenshots, descriptions, and supported language details.
5. Submit the update for review, then monitor its status in the dashboard.
6. After approval, verify the public listing and install/update the published
   extension in a separate Chrome profile.

Never upload a ZIP assembled by hand or from a dirty working tree.

## Troubleshooting

| Symptom | Likely cause and resolution |
| --- | --- |
| Tag validation fails | The tag must be exactly `v` plus the shared package/manifest version. Correct the release commit and create the correct tag. |
| Build validator fails | Rebuild with `npm run build:chrome`; inspect the missing file or manifest mismatch before packaging. |
| Chrome rejects the ZIP | Confirm `manifest.json` is at ZIP root with `unzip -l`, then rerun `npm run pack:chrome`. |
| Extension will not load locally | Load `dist/chrome/`, not `dist/` or the unextracted ZIP. Check the Chrome Extensions errors panel. |
| Store job is skipped | Set `CHROME_WEB_STORE_PUBLISH` to the literal value `true` and confirm the workflow can access the `chrome-web-store` environment. |
| OAuth/token failure | Recreate or reauthorize the refresh token with the Chrome Web Store scope; verify the three secrets belong to the authorized publisher account. |
| Upload fails on version | Increase both local version fields. The store does not accept an update with the existing manifest version. |
| Store review is pending or rejected | Review the dashboard's policy feedback, privacy answers, permissions, listing assets, and any changed extension behavior before resubmitting. |

## Before announcing

Before sharing a release publicly, confirm the GitHub Release ZIP is present,
the repository default branch is public, the README installation instructions
match the release, and the Chrome Web Store listing is live if you intend to
link it. Use the exact supported-browser statement from the README; do not
promise language pairs that Chrome's runtime availability check has not
confirmed.
