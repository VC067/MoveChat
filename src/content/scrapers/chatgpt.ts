import type { Message, AttachedFile, Session } from '../../shared/types';
import { elementToMarkdown } from '../dom';
import { readChatGPTHistory } from './chatgpt-history';

// Wait for an image element to complete loading
function waitForImageLoad(img: HTMLImageElement, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (img.complete) {
      resolve();
      return;
    }
    const onLoad = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); resolve(); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, timeoutMs);
    const cleanup = () => {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
      clearTimeout(timer);
    };
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
  });
}

async function fetchImageBlob(url: string, ms = 5000): Promise<Blob | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'include' });
    return response.ok ? await response.blob() : null;
  } finally {
    clearTimeout(timer);
  }
}

// Convert an image to base64 using Canvas first, then background CORS proxy
const imageData = (value: unknown): value is `data:image/${string};base64,${string}` =>
  typeof value === 'string' && /^data:image\/[^;,]+;base64,.+/.test(value);

function getImageSource(img: HTMLImageElement): string {
  const fromSet = (value: string | null | undefined) => value?.trim().split(/\s+/)[0]?.replace(/,$/, '');
  const sources = [
    img.currentSrc,
    img.getAttribute('src'),
    img.getAttribute('data-src'),
    img.getAttribute('data-original'),
    img.getAttribute('data-lazy-src'),
    fromSet(img.getAttribute('srcset') || img.getAttribute('data-srcset')),
    fromSet(img.closest('picture')?.querySelector('source[srcset]')?.getAttribute('srcset')),
  ].filter((src): src is string => !!src && src !== 'data:,');
  const src = sources.find(value => !/^data:image\/(?:svg\+xml|gif)[;,]/i.test(value)) || sources[0];
  if (!src) return '';
  try {
    return new URL(src, img.baseURI).href;
  } catch {
    return '';
  }
}

async function imageToBase64(img: HTMLImageElement, source: string): Promise<string> {
  if (imageData(source)) return source;

  await waitForImageLoad(img);
  const src = getImageSource(img) || source;
  if (imageData(src)) return src;

  // 1. Try canvas (works for same-origin)
  if (img.currentSrc === src && img.naturalWidth > 0 && img.naturalHeight > 0) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        if (imageData(dataUrl)) return dataUrl;
      }
    } catch {
      // Tainted canvas — fall through
    }
  }

  // 2. Try direct fetch from content script (with timeout)
  try {
    const blob = await fetchImageBlob(src);
    if (blob?.type.startsWith('image/')) {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
  } catch {
    // Cross-origin blocked / timeout — fall through
  }

  // 3. Background CORS proxy (with timeout)
  if (!src.startsWith('https:') || !globalThis.chrome?.runtime) return '';
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve('');
    }, 5000);
    chrome.runtime.sendMessage({ action: 'FETCH_IMAGE_BASE64', url: src }, (resp) => {
      clearTimeout(timer);
      void chrome.runtime.lastError;
      resolve(imageData(resp?.base64) ? resp.base64 : '');
    });
  });
}

// ---------------------------------------------------------------------------
// Message container discovery
// ---------------------------------------------------------------------------

interface RoleCandidate {
  el: Element;
  /** Closest turn/list-item wrapper used to locate adjacent attachments. */
  scope: Element;
  /** Explicit user/assistant role when the DOM declares one, otherwise null. */
  role: 'user' | 'assistant' | null;
}

const RECOGNIZED_ROLES = new Set(['user', 'assistant']);

const TURN_SHELL_SELECTOR = '[data-turn-id][data-turn="user"], [data-turn-id][data-turn="assistant"]';
const TURN_SELECTOR = `[data-testid^="conversation-turn-"], ${TURN_SHELL_SELECTOR}`;

const MESSAGE_SELECTORS = [
  // Legacy UI: role is declared directly on the message element
  '[data-message-author-role]',
  // Newer UI: <li data-message-role="user|assistant"> in the transcript list
  '[data-message-role]',
  // Logged-in app shell: one unit per message, role at the end of the key
  // ("turn-0:1:assistant")
  '[data-content-search-unit-key$=":user"], [data-content-search-unit-key$=":assistant"]',
];

const ASSISTANT_CONTENT = '[data-assistant-markdown-root], [data-markdown-text-style="assistant-message"], .markdown';
const USER_CONTENT = '[data-user-message-bubble], [data-markdown-text-tone="user-message"], .whitespace-pre-wrap';

// ChatGPT can leave previous chats mounted in hidden trees. Off-screen messages
// in the active chat are still valid: never use viewport intersection here.
const isRendered = (element: Element): boolean => {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute('hidden') || current.hasAttribute('inert') || current.getAttribute('aria-hidden') === 'true') return false;
    if (current.getAttribute('role') === 'tabpanel' && current.getAttribute('data-state') === 'inactive') return false;
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden') return false;
  }
  return true;
};

const isConversationNode = (element: Element): boolean => isRendered(element) &&
  !element.closest('nav, aside, [role="navigation"], [role="dialog"], #prompt-textarea, [contenteditable="true"], textarea');

const conversationRoot = (): Element => {
  const mains = Array.from(document.querySelectorAll('main, [role="main"]'));
  if (!mains.length) return document.body; // Older layouts have no main landmark.
  const visible = mains.filter(isRendered);
  const prompt = document.querySelector('#prompt-textarea');
  const composer = prompt && isRendered(prompt) ? prompt : Array.from(document.querySelectorAll('form [contenteditable="true"], form textarea'))
    .find(element => isRendered(element) && !element.closest('[data-code-block], pre'));
  const containingComposer = composer ? visible.filter(main => main.contains(composer)) : [];
  let roots = containingComposer.length ? containingComposer : visible;
  roots = roots.filter(root => !roots.some(other => other !== root && root.contains(other)));
  if (roots.length === 1) return roots[0];
  throw new Error('Cannot identify the active ChatGPT conversation safely. Close overlays, refresh the chat, and try again.');
};

const getUnitKeyRole = (el: Element): string | null => {
  if (!el.hasAttribute('data-content-search-unit-key')) return null;
  const key = el.getAttribute('data-content-search-unit-key') || '';
  return key.split(':').pop() || null;
};

/**
 * A container is a user/assistant message only when its role metadata actually
 * says user or assistant. Unrecognized metadata ("status", "tool", "system")
 * is unrelated status information: it is neither user content nor a role
 * inference blocker — such containers are simply not messages.
 */
const resolveExplicitRole = (el: Element): 'user' | 'assistant' | null => {
  const signals = [
    el.getAttribute('data-message-author-role'),
    el.getAttribute('data-message-role'),
    getUnitKeyRole(el),
  ].filter((s): s is string => !!s);
  const recognized = signals.find((s) => RECOGNIZED_ROLES.has(s));
  return recognized === 'user' || recognized === 'assistant' ? recognized : null;
};

const documentOrder = (a: Element, b: Element): number => {
  if (a === b) return 0;
  const pos = a.compareDocumentPosition(b);
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
};

/**
 * Attachments (images / file pills) often render adjacent to the role-bearing
 * element inside the same turn or list item, so search there — but stay inside
 * the turn so a neighbouring message's attachments are never borrowed.
 */
const attachmentScopeFor = (el: Element): Element =>
  el.closest(TURN_SELECTOR) ?? el.closest('li') ?? el;

const isUnrecognizedRole = (el: Element): boolean => {
  const signals = [
    el.getAttribute('data-message-author-role'),
    el.getAttribute('data-message-role'),
    getUnitKeyRole(el),
  ].filter((s): s is string => !!s);
  return signals.length > 0 && !signals.some((s) => RECOGNIZED_ROLES.has(s));
};

/**
 * Find user/assistant message containers across all known layouts. All three
 * selector families are always queried (not sequentially) so mixed layouts
 * never silently omit messages, then results are scoped, ordered, and
 * deduplicated.
 */
const collectMessageCandidates = (root: Element): RoleCandidate[] => {
  const unique = new Map<Element, 'user' | 'assistant'>();
  for (const selector of MESSAGE_SELECTORS) {
    const matches = [...(root.matches(selector) ? [root] : []), ...Array.from(root.querySelectorAll(selector))];
    for (const el of matches) {
      if (!isConversationNode(el)) continue;
      if (isUnrecognizedRole(el)) continue; // status/tool/system metadata
      const role = resolveExplicitRole(el);
      if (role) unique.set(el, role);
    }
  }

  // Some current layouts expose content markers without role-bearing wrappers.
  // Discover these inside the same active root, never from the rest of the page.
  for (const content of root.querySelectorAll(`${ASSISTANT_CONTENT}, ${USER_CONTENT}`)) {
    if (!isConversationNode(content) || content.closest('pre, code, [data-code-block]')) continue;
    const ancestor = content.closest(MESSAGE_SELECTORS.join(', '));
    if (ancestor && isUnrecognizedRole(ancestor)) continue;
    let role = ancestor ? resolveExplicitRole(ancestor) : null;
    if (!role) {
      const typed = content.closest('[data-user-message-bubble], [data-markdown-text-tone="user-message"], [data-assistant-markdown-root], [data-markdown-text-style="assistant-message"]');
      role = typed ? typed.matches('[data-user-message-bubble], [data-markdown-text-tone="user-message"]') ? 'user' : 'assistant'
        : content.closest(ASSISTANT_CONTENT) ? 'assistant' : 'user';
    }
    let wrapper = ancestor || content.closest(`${TURN_SELECTOR}, [data-message-id]`) || content;
    if (!root.contains(wrapper) || wrapper.querySelector(USER_CONTENT) && wrapper.querySelector(ASSISTANT_CONTENT) && !resolveExplicitRole(wrapper)) {
      wrapper = content;
    }
    if (!unique.has(wrapper)) unique.set(wrapper, role);
  }

  const entries = Array.from(unique.entries()).map(([el, role]) => ({ el, role }));
  entries.sort((a, b) => documentOrder(a.el, b.el));

  // Deduplicate nested role containers (e.g. an <li data-message-role="user">
  // wrapping a legacy [data-message-author-role="user"] div). Keep the
  // outermost one so a single message isn't emitted twice; its attachment
  // scope still covers files/images inside the turn.
  const deduped: RoleCandidate[] = [];
  for (const entry of entries) {
    if (deduped.some((kept) => kept.el.contains(entry.el))) continue;
    deduped.push({
      el: entry.el,
      scope: attachmentScopeFor(entry.el),
      role: entry.role,
    });
  }
  return deduped;
};

/**
 * Oldest fallback: conversation-turn test IDs without usable role attributes.
 * These fill unrepresented turns, including on mixed-layout pages.
 */
const collectTurnFallbackCandidates = (root: Element): RoleCandidate[] => {
  const turns = root.querySelectorAll(TURN_SELECTOR);
  const candidates: RoleCandidate[] = [];
  for (const turn of Array.from(turns)) {
    if (!isConversationNode(turn)) continue;
    if (isUnrecognizedRole(turn)) continue;
    const roleEl = Array.from(turn.querySelectorAll(
      '[data-message-author-role], [data-message-role], [data-content-search-unit-key$=":user"], [data-content-search-unit-key$=":assistant"]'
    )).find(el => isConversationNode(el) && resolveExplicitRole(el));
    if (!roleEl && !turn.querySelector('.markdown, [data-assistant-markdown-root], [data-markdown-text-style="assistant-message"], .whitespace-pre-wrap, [data-user-message-bubble], [data-markdown-text-tone="user-message"], img, a[download], [class*="file-pill"]') &&
        turn.querySelector('[data-message-role], [data-message-author-role]')) continue;
    candidates.push({
      el: roleEl ?? turn,
      scope: turn,
      role: roleEl ? resolveExplicitRole(roleEl) : resolveTurnRole(turn),
    });
  }
  return candidates;
};

const resolveTurnRole = (turn: Element): 'user' | 'assistant' | null => {
  const role = turn.getAttribute('data-turn');
  return role === 'user' || role === 'assistant' ? role : null;
};

const collectCandidates = (root: Element): RoleCandidate[] => {
  const explicit = collectMessageCandidates(root);
  const fallback = collectTurnFallbackCandidates(root).filter(turn =>
    !explicit.some(candidate => turn.scope.contains(candidate.el) || candidate.el.contains(turn.el))
  );
  return [...explicit, ...fallback].sort((a, b) => documentOrder(a.el, b.el));
};

// ---------------------------------------------------------------------------
// Content and attachment extraction
// ---------------------------------------------------------------------------

/** Prefer the broadest node: drop matches nested inside another match. */
const pickOutermost = (nodes: Element[]): Element | null => {
  nodes = nodes.filter(isRendered);
  const outermost = nodes.filter((n) => !nodes.some((o) => o !== n && o.contains(n)));
  if (outermost.length === 0) return null;
  if (outermost.length === 1) return outermost[0];
  // A response can contain several independent Markdown sections (e.g. prose,
  // code, then more prose). Retain them all rather than choosing the longest.
  const combined = document.createElement('div');
  outermost.forEach(node => combined.appendChild(node.cloneNode(true)));
  return combined;
};

/**
 * Pick the text content node. A tiny nested .markdown (e.g. inside a quoted
 * fragment) never wins when a broader assistant root exists.
 */
const selectContentNode = (container: Element, role: 'user' | 'assistant' | null): Element => {
  if (role !== 'user') {
    const assistantRoot = pickOutermost(Array.from(container.querySelectorAll(
      '[data-assistant-markdown-root], [data-markdown-text-style="assistant-message"]'
    )));
    if (assistantRoot) return assistantRoot;
    const markdown = pickOutermost(Array.from(container.querySelectorAll('.markdown')));
    if (markdown) return markdown;
  }
  if (role !== 'assistant') {
    const userNode = pickOutermost(Array.from(container.querySelectorAll(
      '[data-user-message-bubble], [data-markdown-text-tone="user-message"], .whitespace-pre-wrap'
    )));
    if (userNode) return userNode;
    const markdown = pickOutermost(Array.from(container.querySelectorAll('.markdown')));
    if (markdown) return markdown;
  }
  return container;
};

/** True when a node lives inside a different message's role container. */
const belongsToOtherCandidate = (
  node: Element,
  candidate: RoleCandidate,
  candidates: RoleCandidate[]
): boolean => {
  const containedOwner = candidates.find(c => c.el.contains(node));
  if (containedOwner) return containedOwner.el !== candidate.el;
  const peers = candidates.filter(c => candidate.scope.contains(c.el));
  if (peers.length < 2) return false;
  // Some layouts put both roles in one turn with sibling attachments. Associate
  // those with the preceding message (or the first one for leading uploads),
  // rather than duplicating them onto every message in the shared turn.
  const owner = peers.filter(c => documentOrder(c.el, node) < 0).at(-1) || peers[0];
  return owner.el !== candidate.el;
};

interface CaptureImages {
  names: Set<string>;
  saved: number;
  missing: number;
}

const newImageCapture = (): CaptureImages => ({ names: new Set(), saved: 0, missing: 0 });

const collectImages = async (
  candidate: RoleCandidate,
  candidates: RoleCandidate[],
  imageCapture: CaptureImages
): Promise<AttachedFile[]> => {
  const files: AttachedFile[] = [];
  const images = Array.from(candidate.scope.querySelectorAll('img'))
    .filter((img) => isRendered(img) && !belongsToOtherCandidate(img, candidate, candidates));

  for (const img of images) {
    const src = getImageSource(img);
    const alt = img.getAttribute('alt') || '';

    const isDecorative = img.closest('[class*="avatar"], [data-testid*="avatar"], [class*="favicon"]') !== null;

    if (isDecorative || !src) continue;

    const base64 = await imageToBase64(img, src);
    if (!imageData(base64)) {
      imageCapture.missing++;
      continue;
    }
    if (!files.some(file => file.content === base64)) {
      // Numbering continues across messages: count images already captured
      // by earlier messages plus the ones collected for this message.
      const type = base64.match(/^data:(image\/[^;,]+)/)?.[1] || 'image/png';
      const extension = type === 'image/jpeg' ? 'jpg' : type.split('/')[1].replace(/[^a-z0-9]/gi, '') || 'png';
      const originalName = (alt || `image-${imageCapture.saved + files.length + 1}.${extension}`).replace(/[\\/]/g, '_');
      let name = originalName;
      let duplicate = 2;
      while (imageCapture.names.has(name)) {
        const dot = originalName.lastIndexOf('.');
        name = dot > 0 ? `${originalName.slice(0, dot)}-${duplicate++}${originalName.slice(dot)}` : `${originalName}-${duplicate++}`;
      }
      imageCapture.names.add(name);
      files.push({ name, type, content: base64 });
    }
  }
  imageCapture.saved += files.length;
  return files;
};

const collectFilePills = (
  candidate: RoleCandidate,
  candidates: RoleCandidate[]
): AttachedFile[] => {
  const matches = Array.from(
    candidate.scope.querySelectorAll('a[download], [class*="file-pill"], [class*="attachment"]')
  ).filter((pill) => isRendered(pill) && !belongsToOtherCandidate(pill, candidate, candidates));

  // Outermost pill only: nested pills describe the same attachment.
  const pills = matches.filter(
    (pill) => !matches.some((other) => other !== pill && other.contains(pill))
  );

  const files: AttachedFile[] = [];
  for (const pill of pills) {
    // An image-only attachment wrapper isn't a second, nameless document.
    const cleanedName = (pill.getAttribute('download') || pill.textContent || '').trim();
    if (cleanedName && !files.some(f => f.name === cleanedName)) {
      files.push({
        name: cleanedName,
        type: 'application/octet-stream',
      });
    }
  }
  return files;
};

async function readMessage(
  candidate: RoleCandidate,
  candidates: RoleCandidate[],
  imageCapture: CaptureImages
): Promise<Message | null> {
  const role = candidate.role ?? (candidate.el.querySelector(ASSISTANT_CONTENT) ? 'assistant' : 'user');
  const content = elementToMarkdown(selectContentNode(candidate.el, role)).trim();
  const missingBeforeMessage = imageCapture.missing;
  const files = await collectImages(candidate, candidates, imageCapture);
  for (const file of collectFilePills(candidate, candidates)) {
    if (!files.some(existing => existing.name === file.name)) files.push(file);
  }
  return content || files.length || imageCapture.missing > missingBeforeMessage
    ? { role, content, files: files.length ? files : undefined }
    : null;
}

type ReportProgress = (current: number, total: number, step: string) => void;

const getTurnShells = (root: Element): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(TURN_SHELL_SELECTOR)).filter(isConversationNode);

const TURN_MEDIA = 'img, a[download], [class*="file-pill"]';

function mountedTurnCandidates(shell: Element): RoleCandidate[] {
  const candidates = collectMessageCandidates(shell).filter(candidate =>
    !!candidate.el.textContent?.trim() || !!candidate.scope.querySelector(TURN_MEDIA)
  );
  if (candidates.length) return candidates;
  const content = shell.querySelector(`${ASSISTANT_CONTENT}, ${USER_CONTENT}, ${TURN_MEDIA}`);
  return content && (content.matches(TURN_MEDIA) || !!content.textContent?.trim() || !!shell.querySelector(TURN_MEDIA))
    ? [{ el: shell, scope: shell, role: resolveTurnRole(shell) }]
    : [];
}

const countImages = (message: Message): number =>
  message.files?.filter(file => file.type.startsWith('image/')).length ?? 0;

async function readVirtualizedTurns(
  root: Element,
  shells: HTMLElement[],
  assertSameConversation: () => void,
  imageCapture: CaptureImages,
  onProgress?: ReportProgress
): Promise<Message[]> {
  const initialUrl = location.href.split('#')[0];
  const initialTitle = document.title;
  const turnIds = shells.map(shell => shell.getAttribute('data-turn-id'));
  if (new Set(turnIds).size !== shells.length) throw new Error('ChatGPT displayed duplicate turns. Refresh the chat and try again.');
  const scroller = shells[0].closest<HTMLElement>('[data-scroll-root], .thread-scroll-container') ?? document.scrollingElement;
  const initialScroll = scroller?.scrollTop ?? 0;
  const saved: Message[] = [];
  let scrolled = false;

  try {
    for (let i = 0; i < shells.length; i++) {
      const shell = shells[i];
      const verifyTurn = () => {
        assertSameConversation();
        if (!root.contains(shell) || !isConversationNode(shell) || shell.getAttribute('data-turn-id') !== turnIds[i]) {
          throw new Error('ChatGPT replaced a message during capture. Nothing was saved. Try again after the reply finishes.');
        }
      };
      onProgress?.(i, shells.length, `Loading message ${i + 1} of ${shells.length}...`);
      verifyTurn();
      let candidates = mountedTurnCandidates(shell);
      if (!candidates.length) {
        scrolled = true;
        shell.scrollIntoView({ block: 'center', behavior: 'instant' });
        for (let attempt = 0; attempt < 40 && !candidates.length; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          verifyTurn();
          candidates = mountedTurnCandidates(shell);
        }
      }
      if (!candidates.length) {
        throw new Error(`ChatGPT did not load message ${i + 1} of ${shells.length}. Nothing was saved. Keep the chat tab open and try again.`);
      }

      let changed = false;
      const observer = new MutationObserver(() => { changed = true; });
      observer.observe(shell, {
        childList: true, characterData: true, subtree: true, attributes: true,
        attributeFilter: ['data-message-id', 'data-message-author-role', 'data-message-role', 'data-content-search-unit-key'],
      });
      const savedBeforeTurn = saved.length;
      try {
        for (const candidate of candidates) {
          const message = await readMessage(candidate, candidates, imageCapture);
          verifyTurn();
          if (changed || observer.takeRecords().length) {
            throw new Error('ChatGPT changed a message during capture. Nothing was saved. Keep the chat tab open and try again.');
          }
          if (message) saved.push(message);
        }
      } finally {
        observer.disconnect();
      }
      if (savedBeforeTurn === saved.length) throw new Error(`ChatGPT did not display message ${i + 1} of ${shells.length}. Nothing was saved.`);
    }
    const currentShells = getTurnShells(root);
    if (currentShells.length !== shells.length || currentShells.some((shell, i) =>
      shell !== shells[i] || shell.getAttribute('data-turn-id') !== turnIds[i]
    )) {
      throw new Error('ChatGPT changed the conversation during capture. Nothing was saved. Refresh the chat and try again.');
    }
    return saved;
  } finally {
    if (scrolled && scroller?.isConnected && root.isConnected &&
        location.href.split('#')[0] === initialUrl && document.title === initialTitle) {
      scroller.scrollTop = initialScroll;
    }
  }
}

function buildSession(sourceTitle: string, messages: Message[], missingImageCount: number): Omit<Session, 'id' | 'platform'> {
  let title = sourceTitle || 'ChatGPT Handoff';
  if (title === 'ChatGPT' || title.trim() === '') {
    const firstUser = messages.find(message => message.role === 'user' && message.content.trim());
    title = firstUser ? firstUser.content.substring(0, 40) + '...' : 'ChatGPT Handoff';
  }
  const imageCount = messages.reduce((count, message) => count + countImages(message), 0);
  const fileCount = messages.reduce((count, message) => count + (message.files?.length ?? 0), 0) - imageCount;
  return {
    title, messages, messageCount: messages.length, imageCount, fileCount,
    ...(missingImageCount > 0 ? { missingImageCount } : {}),
    savedAt: new Date().toISOString(), startedAt: new Date().toISOString(),
  };
}

export const scrapeChatGPT = async (
  onProgress?: ReportProgress
): Promise<Omit<Session, 'id' | 'platform'>> => {
  onProgress?.(0, 1, 'Finding messages...');

  const sourceUrl = window.location.href;
  const sourceTitle = document.title;
  const root = conversationRoot();
  const assertSameConversation = () => {
    if (window.location.href.split('#')[0] !== sourceUrl.split('#')[0] || document.title !== sourceTitle || !root.isConnected || !isRendered(root)) {
      throw new Error('ChatGPT changed conversations during capture. Nothing was saved. Wait for the chat to load, then capture again.');
    }
  };
  const mounted = collectCandidates(root);
  const visible = new Map<string, Message>();
  for (const candidate of mounted) {
    const id = candidate.el.getAttribute('data-message-id') ?? candidate.el.querySelector('[data-message-id]')?.getAttribute('data-message-id');
    if (!id || !candidate.role) continue;
    visible.set(id, {
      role: candidate.role,
      content: elementToMarkdown(selectContentNode(candidate.el, candidate.role)).trim(),
      files: collectFilePills(candidate, mounted),
    });
  }
  const history = await readChatGPTHistory(sourceUrl, visible, assertSameConversation, onProgress);
  assertSameConversation();
  if (history) return buildSession(sourceTitle, history.messages, history.missingImageCount);

  const imageCapture = newImageCapture();
  const shells = getTurnShells(root);
  if (shells.some(shell => !mountedTurnCandidates(shell).length)) {
    const messages = await readVirtualizedTurns(root, shells, assertSameConversation, imageCapture, onProgress);
    return buildSession(sourceTitle, messages, imageCapture.missing);
  }

  const candidates = collectCandidates(root);
  if (candidates.length === 0) {
    throw new Error('No messages found. Are you in a chat session?');
  }

  let contentChanged = false;
  const observer = new MutationObserver(() => { contentChanged = true; });
  observer.observe(root, {
    childList: true, characterData: true, subtree: true, attributes: true,
    attributeFilter: ['data-message-author-role', 'data-message-role', 'data-content-search-unit-key', 'hidden', 'inert', 'aria-hidden'],
  });
  const assertCurrentCandidates = (current?: RoleCandidate) => {
    assertSameConversation();
    if (contentChanged || observer.takeRecords().length || (current ? [current] : candidates).some(candidate =>
      !candidate.el.isConnected || !root.contains(candidate.el) || !isConversationNode(candidate.el)
    )) {
      throw new Error('ChatGPT changed or replaced the conversation content during capture. Nothing was saved. Wait for the reply to finish, then capture again.');
    }
  };

  try {
    onProgress?.(0, candidates.length, 'Loading images...');

    // Pre-load only rendered images from this conversation, not cached chats.
    const allPageImages = Array.from(root.querySelectorAll<HTMLImageElement>('img')).filter(isRendered);
    await Promise.all(allPageImages.map(img => waitForImageLoad(img, 3000)));
    assertCurrentCandidates();

    const messages: Message[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      assertCurrentCandidates(candidate);
      onProgress?.(i + 1, candidates.length, `Processing message ${i + 1}/${candidates.length}...`);

      const message = await readMessage(candidate, candidates, imageCapture);
      if (message) messages.push(message);
    }

    if (messages.length === 0) throw new Error('No messages found. Are you in a chat session?');
    assertCurrentCandidates();
    return buildSession(sourceTitle, messages, imageCapture.missing);
  } finally {
    observer.disconnect();
  }
};
