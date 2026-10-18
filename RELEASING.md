# Releasing MoveChat

## Build the reviewed packages

Use a clean Git checkout of the intended release commit and Node.js 26.7.0 (or compatible recent Node.js 24.15+/26+):

```sh
npm ci
npm run build:release
```

This runs tests and the production build, then creates `release-artifacts/v<version>/` containing:

- `movechat-chrome-v<version>.zip`: Chrome Web Store upload / unpacked developer install.
- `movechat-firefox-v<version>.zip`: Firefox Add-ons upload / unsigned temporary testing.
- `movechat-source-v<version>.zip`: readable sources, lockfile, jsPDF patch, tests and reviewer build instructions.
- `SHA256SUMS.txt`, `BUILD_INFO.json`, `BUILD_INSTRUCTIONS.md`, and `RELEASE_NOTES.md`.

Browser ZIPs use sorted entries and fixed timestamps. Rebuilding the same sources with the same toolchain should produce the same packages. The source archive records the commit and toolchain. Local captures, credentials, old ZIPs, and the local review report are excluded.

For reviewer source-archive builds (without `.git`), follow the included `BUILD_INSTRUCTIONS.md`: `npm ci`, `npm test`, then `npm run build:firefox:test`. The resulting `dist/` and `dist-firefox-test/` files reproduce the browser packages without Git metadata.

The historical `movechat-*-store.zip` files at the repository root are **not** the output of this command. Use the versioned release assets for new submissions, not an older root ZIP or test artifact.

## Publish on GitHub

Merge the tested combined changes normally (not squash) to preserve contributor commits. Tag that merged commit as `v<version>` and upload the versioned browser/source ZIPs and checksums as release assets. GitHub tracks asset downloads; these are not browser-store installs or unique-user counts.

## Update the existing store listings

Publishing a GitHub release updates neither store. Verify the new version is greater than every previously uploaded store version before submitting.

### Chrome

1. Sign in to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Open the existing MoveChat item (`cgpfngggfccdpjppachknliainihkbdg`). Do not create a new listing.
3. Under **Package**, choose **Upload new package** and select the Chrome ZIP.
4. Review privacy/permission declarations and release details, then submit for review. Manual/deferred publishing can be selected when available.

### Firefox

1. Sign in to the [Firefox Add-ons Developer Hub](https://addons.mozilla.org/developers/addons).
2. Open the existing [MoveChat add-on](https://addons.mozilla.org/en-US/firefox/addon/movechat/) and submit a new version using the Firefox ZIP.
3. Provide the source ZIP and its `BUILD_INSTRUCTIONS.md` for reviewing the bundled/minified build. Preserve add-on ID `movechat@vc067.github.io`.
4. Review the data declarations, version notes and validation warnings before submitting. Mozilla performs signing/review; the GitHub Firefox ZIP is not a signed permanent install.

Store credentials must be configured through a secure local environment or the signed-in dashboards. Never put passwords, API secrets, private signing keys or refresh tokens in chat, source control, release notes, or upload archives.

Update store-version badges only after each new store version is actually available. Do not overwrite assets of an already published release with a different build.
