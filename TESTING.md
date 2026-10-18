# Local acceptance test — v1.2.1

Nothing in this checklist pushes code, merges a PR, publishes a release, or submits a store update.

## Load the fresh test build

The Chrome test build is in `dist/`. If already loaded, open `chrome://extensions` and click **Reload** on the unpacked MoveChat. Otherwise enable Developer mode, choose **Load unpacked**, and select `dist/`.

Temporarily disable the store-installed copy so you test the right extension. Do not uninstall it: its saved chats belong to that installation. Then **refresh the ChatGPT conversation tab** so its content script updates too.

For Firefox, use the unsigned `dist-firefox-test/manifest.json` through `about:debugging` → **This Firefox** → **Load Temporary Add-on**. This is a test copy, not a signed permanent installation. Prefer a separate Firefox test profile if MoveChat is already installed.

To regenerate the test copies:

```sh
npm test
npm run build
npm run build:firefox:test
```

Tests use development-only tooling and require a recent Node.js (24.15+ or 26+ recommended).

## Required manual checks

**Check conversation isolation first.** Use two harmless chats with different markers, for example `MOVECHAT_PYTHON_A` and `MOVECHAT_TEST_B`. Capture A, switch to B and capture it, then return to A and capture again **without refreshing between those switches**. Wait for each chat to finish loading before capture. Every saved entry must contain only that chat's messages and its **Captured page** URL must match the visible chat's address. Markdown/PDF exports now include that source URL too. If a chat changes during capture, an error with no newly saved entry is the expected safe outcome.

Do not re-download the previously incorrect saved entry: it already contains the wrong data and cannot repair itself. Choose the fresh capture with the new timestamp and recorded source URL. Do not resume/share the incorrect entry.

1. **Recapture your existing Python test conversation.** Do not re-export the old saved capture. Check that every user/assistant turn is present once, in order, with normal word spacing.
2. **Export Markdown and PDF.** All Python code must be present in both, with indentation and blank lines. PDF code must be visible, `summarize_groups()` must retain its underscore, and tables/lists must remain readable. “Example:” must not disappear. With images, Markdown may download as a ZIP: extract it and check `transcript.md` plus `images/` together.
3. **Attach a harmless screenshot in ChatGPT and recapture.** The image count should increase and the screenshot should appear in the PDF/exported ZIP. Separately try an image-only message. Document cards may expose only the filename, not the original downloadable bytes; do not treat a filename as proof that the file contents transferred.
4. **Resume with Auto-send OFF.** Use a fresh test conversation. Confirm the handoff prompt and transcript attachment appear, without a camera dialog or an automatically sent message. Open the attachment and verify its contents if the target UI permits it.
5. **Quick regression check.** Capture one code-containing conversation on another supported platform you use. Confirm it remains readable. Restart the browser and verify the test copy's saved capture is still accessible. Repeat capture/export/resume in Firefox before a store submission.

## If anything fails

Save the new Markdown/PDF (and JSON export if possible), note Chrome versus Firefox and the failed checklist number, and share the files' paths. If text/code still disappears on a live layout, a redacted assistant-message HTML snapshot will help reproduce it exactly. Do not share private chats, API keys, or account credentials.

If capture fails to recognize the active ChatGPT layout, `scripts/chatgpt-diagnostic.js` can be pasted into the ChatGPT DevTools Console. It copies/logs selector counts and visibility metadata only, with no message text, title, conversation IDs, cookies, storage, or network calls. Share that diagnostic instead of an entire private page.

Approval for merging/release work comes **after** these checks. Existing store ZIPs and earlier temporary release ZIPs are not the newly tested packages and must be rebuilt after approval.
