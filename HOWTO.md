# Publishing SubMate

This is the complete operator guide for publishing SubMate. It intentionally
keeps the first Chrome Web Store submission manual; after that, GitHub Actions
can build the verified package, create the GitHub Release, upload it to the
store, and submit it for review.

## 1. Create the required accounts

1. Create or use a GitHub account that administers `ghassenbrg/SubMate`.
2. Create or use a Google account for the Chrome Web Store publisher. Enable
   two-step verification on that account; Chrome requires it for publishing.
3. Register that account in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
   Pay the one-time registration fee if the dashboard asks for it.
4. Create or select a Google Cloud project owned by a trusted maintainer.
   Do not use a personal project that will be abandoned when a contributor
   leaves.

## 2. Publish the first Chrome Web Store item manually

The API updates an existing item. The first submission must be set up in the
Developer Dashboard.

1. Build the exact package from the reviewed release commit:

   ```sh
   npm ci
   npm run validate
   npm run pack:chrome
   ```

2. Open `dist/packages/submate-chrome-vX.Y.Z.zip` and confirm `manifest.json`
   is at the ZIP root. Do not re-zip the files manually.
3. In the Developer Dashboard, select **New item** and upload that ZIP.
4. Complete every required Store listing field: name, short and detailed
   descriptions, category, language, support contact, promotional imagery,
   screenshots, and any current Chrome policy disclosures.
5. Complete the Privacy tab truthfully. SubMate has no SubMate account,
   analytics, or backend. Its default translator stays on-device. When a user
   enables Cloud API translation, subtitle text and language information go
   directly to the provider the user selected. Re-check these answers for every
   release that changes data handling or permissions.
6. Complete any permissions justifications, then submit the item for review.
7. Once the item exists, copy its **Item ID** from the dashboard or the listing
   URL, and copy the **Publisher ID** from **Publisher > Settings**. The Item
   ID is required for subsequent automated uploads.

## 3. Configure Chrome Web Store API access

1. In Google Cloud Console, enable **Chrome Web Store API** for the selected
   Cloud project.
2. Open **APIs & Services > OAuth consent screen**. Create an **External**
   consent screen, enter the app name, support email, and developer contact,
   then add the publisher account as a test user if the app remains in testing.
3. Open **Credentials > Create credentials > OAuth client ID**. Choose **Web
   application** and add this authorized redirect URI exactly:

   ```text
   https://developers.google.com/oauthplayground
   ```

4. Save the OAuth **client ID** and **client secret** somewhere secure.
5. Open the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
   Select the settings cog, enable **Use your own OAuth credentials**, and enter
   the client ID and secret.
6. In **Input your own scopes**, use exactly:

   ```text
   https://www.googleapis.com/auth/chromewebstore
   ```

7. Authorize with the Google account that owns the SubMate store item, then
   exchange the authorization code for tokens. Save the **refresh token**. It
   is a long-lived credential: never put it in source code, an issue, a log, or
   a pull request.

Google's [current API guide](https://developer.chrome.com/docs/webstore/using-api)
is the authority if the dashboard labels or token flow change.

## 4. Configure GitHub Actions secrets and variables

1. In GitHub, open **Settings > Environments** for `ghassenbrg/SubMate` and
   create an environment named `chrome-web-store`. Restrict deployment access
   to trusted maintainers if appropriate.
2. Add these environment secrets to `chrome-web-store`:

   | Secret | Value |
   | --- | --- |
   | `CHROME_WEB_STORE_CLIENT_ID` | OAuth client ID |
   | `CHROME_WEB_STORE_CLIENT_SECRET` | OAuth client secret |
   | `CHROME_WEB_STORE_REFRESH_TOKEN` | OAuth refresh token with the Chrome Web Store scope |

3. In **Settings > Secrets and variables > Actions > Variables**, add:

   | Variable | Value |
   | --- | --- |
   | `CHROME_WEB_STORE_PUBLISH` | `true` to turn on store upload; leave unset until the first item is ready |
   | `CHROME_WEB_STORE_PUBLISHER_ID` | Publisher ID from the Developer Dashboard |
   | `CHROME_WEB_STORE_EXTENSION_ID` | Existing SubMate store item ID |

4. Keep `CHROME_WEB_STORE_PUBLISH` disabled until the manual listing is fully
   configured. With it disabled, release builds and GitHub Releases still run;
   only the store job is skipped.

## 5. Configure GitHub Pages and the future custom domain

1. In GitHub **Settings > Pages**, set **Source** to **GitHub Actions**.
   The `Deploy website` workflow deploys the `website/` directory when it
   changes on `main`, or on manual dispatch.
2. The initial site address is the GitHub Pages URL shown by the deployment,
   normally `https://ghassenbrg.github.io/SubMate/`.
3. When DNS for `submate.ghassen.io` is ready, add that domain in GitHub Pages
   settings and follow GitHub's DNS verification instructions. For a subdomain,
   this is normally a `CNAME` record pointing at `ghassenbrg.github.io`.
4. Only after GitHub confirms the domain, add a `website/CNAME` file containing
   `submate.ghassen.io`, commit it, and enable **Enforce HTTPS** in Pages.
   The site uses relative internal links, so it works at the project Pages URL
   and at the custom domain without a rebuild.

## 6. Prepare a versioned release

SubMate follows Semantic Versioning. Update both `package.json` and
`public/manifest.json` to the same `MAJOR.MINOR.PATCH` version:

- Patch: compatible bug fix.
- Minor: compatible new feature.
- Major: breaking change, platform/support change, or incompatible
  configuration change.

Then:

1. Add user-facing release notes to `CHANGELOG.md`.
2. Review `public/manifest.json`; any new permission needs a fresh store-policy
   and privacy review.
3. Run the release gate locally:

   ```sh
   npm ci
   npm run validate
   npm run pack:chrome
   ```

4. Load `dist/chrome/` in `chrome://extensions` and complete the relevant live
   cases in [docs/MANUAL_TESTING.md](docs/MANUAL_TESTING.md).
5. Open a pull request, have it reviewed, and merge it into `main`.

## 7. Create and publish the release

From the merged release commit on `main`:

```sh
git tag -a vX.Y.Z -m "SubMate vX.Y.Z"
git push origin vX.Y.Z
```

The tag must exactly match the version: `v0.1.1` for version `0.1.1`. The
`Release extension` workflow verifies this, tests and packages the extension,
uploads a retained workflow artifact, creates or updates the GitHub Release,
and—when the publish variable is exactly `true`—uploads and submits the ZIP to
the Chrome Web Store API.

Monitor the Chrome Web Store dashboard after the workflow succeeds. Uploading
or submitting is not approval; review time and listing visibility are controlled
by Chrome. If automation is intentionally disabled, upload the generated GitHub
Release ZIP manually through the dashboard instead.

## 8. Final checks and recovery

1. Confirm the GitHub Release contains `submate-chrome-vX.Y.Z.zip`.
2. Confirm the website's installation and release links are live.
3. After Store approval, replace the Chrome Web Store placeholder links in the
   README and website with the final listing URL.
4. Install the public store build in a separate Chrome profile and check an
   actual supported title.

If token exchange fails, regenerate and re-authorize the refresh token with the
same scope. If an upload is rejected because of a version, increment both local
version fields and cut a new tag. If a release workflow must be retried, use
**Run workflow** with an existing tag; it checks out that tag rather than the
current branch tip.
