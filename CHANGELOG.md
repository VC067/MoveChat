# Changelog

## v1.2.2

### Fixed

- Finish saving a conversation after the extension popup closes and restore the progress display when it reopens. (#6)
- Keep the transcript and supporting files attached when ChatGPT replaces the composer. Retry missing files without using the camera input and wait for the prompt and all attachments before Auto-send. (#5)
- Resume a saved ChatGPT Temporary Chat in Temporary Chat mode and deliver each handoff only to the tab opened for it.
- Let long captures continue past three minutes while progress advances, and time out stalled captures. (#7)
- Retrieve the active ChatGPT conversation and its images even when older messages are outside the viewport. Save the transcript and flag unavailable images when an image download fails.
- Save larger local conversations, transfer large captures in chunks, and keep the transcript if image data exceeds available storage.
- Overlap scroll steps in DeepSeek to capture turns that load near the edge of the viewport.
- Resume large saved conversations when the handoff exceeds the browser's temporary storage quota.

## v1.2.1 — 2026-10-18

### Fixed

- Capture ChatGPT conversations using the newer logged-in and logged-out layouts, while keeping support for older layouts.
- Preserve indentation and blank lines inside fenced code blocks during capture and Markdown export.
- Capture ChatGPT's newer code-block containers and language labels.
- Attach handoff files to ChatGPT's unrestricted file input instead of its camera input.
- Preserve ordinary text before code blocks instead of mistaking it for a language label.
- Preserve spaces between nested text elements, table rows, line breaks, and ordered lists.
- Fall back to existing code sources when ChatGPT code wrappers differ, instead of silently exporting empty blocks.
- Deduplicate nested message containers and retain mixed-layout and image-only messages.
- Include images adjacent to their message inside the same ChatGPT turn/list item.
- Render PDF code backgrounds before the code text, preserve inline-code identifiers, and support longer Markdown fences.
- Keep short PDF code examples together and paginate long code/table content without hiding text.
- Restrict ChatGPT capture to the visible active conversation; ignore hidden cached chats, sidebars, dialogs and unsent drafts.
- Reject page/DOM changes during capture and mismatched source URLs instead of saving a mixed conversation.
- Pin capture to the chosen tab's top frame, bound injection retries, and prevent duplicate saves/receiver listeners.
- Record the capture's source URL in new saved entries and Markdown/PDF exports.

### Changed

- Remove unnecessary Unsplash and Imgur host permissions; their image endpoints support cross-origin requests.
- Add optional Ko-fi support links to the README and landing page, plus GitHub's Sponsor button configuration.
- Add reproducible capture/export/handoff regression tests (`npm test`) and an unsigned Firefox test-build command.
- Add reproducible, versioned Chrome/Firefox release packages, SHA-256 checksums, and a source archive for Firefox review.

### Installation

- **Chrome / Chromium:** Download `movechat-chrome-v1.2.1.zip`, extract it, enable Developer mode at `chrome://extensions`, and choose **Load unpacked**.
- **Firefox:** Download `movechat-firefox-v1.2.1.zip` for temporary testing through `about:debugging` → **This Firefox** → **Load Temporary Add-on**. This GitHub build is unsigned; use the [Firefox Add-ons listing](https://addons.mozilla.org/en-US/firefox/addon/movechat/) for permanent installation.

GitHub release downloads are counted separately from Chrome Web Store and Firefox Add-ons installations. Publishing this release does not update either store listing.
