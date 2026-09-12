# Contributing to SubMate

Thanks for helping improve SubMate. By contributing, you agree that your contributions may be distributed under the repository's [MIT License](LICENSE).

## Before you start

- Search existing issues and pull requests before opening a new one.
- For security-sensitive findings, follow [SECURITY.md](SECURITY.md) instead of filing a public issue.
- Keep the extension independent of the services it supports. Do not add streaming-service credentials, copyrighted subtitle files, account details, or private viewing data to the repository, issues, screenshots, tests, or pull requests.
- New platforms belong behind the `PlatformAdapter` contract rather than in the shared core. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Local workflow

1. Fork the repository and create a focused branch.
2. Install dependencies with `npm ci`.
3. Make the smallest complete change and include tests when behavior changes.
4. Run `npm run validate`.
5. For UI, manifest, subtitle, or playback changes, manually load `dist/chrome/` in Chrome and complete the relevant cases in [docs/MANUAL_TESTING.md](docs/MANUAL_TESTING.md).
6. Update documentation and `CHANGELOG.md` when users or release behavior are affected.

## Pull request expectations

Explain the problem, the approach, test evidence, and any manual test results. Keep pull requests focused and avoid unrelated formatting changes. Do not commit generated `dist/`, `coverage/`, dependency credentials, or exported subtitle content. Sanitized screenshots are welcome when they help review UI changes.

## Adding locales

Follow [docs/LOCALIZATION.md](docs/LOCALIZATION.md). Every locale must contain the same non-empty message keys as the English catalog; the test suite checks this automatically.
