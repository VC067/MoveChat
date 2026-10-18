// Optional: paste into the ChatGPT DevTools Console if capture still fails.
// Reports selector/visibility metadata only, with no message text, titles or IDs.
// Does not access cookies, storage, network requests or API keys.
(() => {
  const selectors = [
    '[data-message-author-role]', '[data-message-role]', '[data-content-search-unit-key]',
    '[data-assistant-markdown-root]', '[data-markdown-text-style="assistant-message"]',
    '[data-markdown-text-tone="user-message"]', '[data-user-message-bubble]',
    '.markdown', '.whitespace-pre-wrap', '[data-testid^="conversation-turn-"]', '[data-message-id]',
  ];
  const rendered = element => {
    for (let parent = element; parent; parent = parent.parentElement) {
      if (parent.hasAttribute('hidden') || parent.hasAttribute('inert') || parent.getAttribute('aria-hidden') === 'true') return false;
      const style = getComputedStyle(parent);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden') return false;
    }
    return true;
  };
  const roots = [...document.querySelectorAll('main, [role="main"]')];
  const counts = root => Object.fromEntries(selectors.map(selector => {
    const elements = [...root.querySelectorAll(selector)];
    return [selector, { total: elements.length, rendered: elements.filter(rendered).length }];
  }));
  const prompt = document.querySelector('#prompt-textarea');
  const report = JSON.stringify({
    origin: location.origin,
    conversationRoute: location.pathname.includes('/c/'),
    readyState: document.readyState,
    roots: roots.map((root, index) => ({ index, tag: root.tagName, rendered: rendered(root), containsPrompt: !!prompt && root.contains(prompt), counts: counts(root) })),
    documentCounts: counts(document),
  }, null, 2);
  if (typeof copy === 'function') copy(report); // Chrome DevTools clipboard helper.
  console.log(report);
  console.log('MoveChat selector diagnostic only — no chat contents included.');
})();
