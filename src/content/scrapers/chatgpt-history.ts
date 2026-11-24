import type { AttachedFile, Message } from '../../shared/types';

const origin = 'https://chatgpt.com';
type Progress = (current: number, total: number, step: string) => void;

interface Attachment {
  id: string;
  name?: string;
}

interface Turn {
  id: string;
  message: Message;
  images: Attachment[];
}

interface History {
  messages: Message[];
  missingImageCount: number;
}

type ApiFetch = (path: string, accept?: string) => Promise<Response>;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const string = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function imageId(value: unknown): string | undefined {
  const id = string(value)?.replace(/^(?:sediment|file-service):\/\//, '');
  return id && /^file[_-][\w-]+$/.test(id) ? id : undefined;
}

function imagesFor(parts: unknown[], metadata: Record<string, unknown> | undefined): Attachment[] {
  const images = new Map<string, Attachment>();
  for (const part of parts) {
    const item = record(part);
    const id = item?.content_type === 'image_asset_pointer' ? imageId(item.asset_pointer) : undefined;
    if (id) images.set(id, { id });
  }
  for (const attachment of array(metadata?.attachments)) {
    const item = record(attachment);
    const id = imageId(item?.id ?? item?.file_id);
    const name = string(item?.name ?? item?.file_name);
    const mime = string(item?.mime_type ?? item?.mimeType);
    if (id && (images.has(id) || mime?.startsWith('image/') || /\.(?:png|jpe?g|gif|webp|avif|bmp|heic|svg)$/i.test(name ?? ''))) {
      images.set(id, { id, name });
    }
  }
  return [...images.values()];
}

/** Follow only the active branch. A broken chain is not a complete transcript. */
function readTurns(body: unknown, conversationId: string): Turn[] | null {
  const response = record(body);
  const responseId = string(response?.conversation_id);
  if (responseId && responseId !== conversationId) return null;
  const mapping = record(response?.mapping);
  let cursor = string(response?.current_node);
  if (!mapping || !cursor) return null;

  const seen = new Set<string>();
  const turns: Turn[] = [];
  while (cursor) {
    const node = record(mapping[cursor]);
    if (!node || seen.has(cursor)) return null;
    seen.add(cursor);
    const data = record(node.message);
    const role = record(data?.author)?.role;
    const metadata = record(data?.metadata);
    if ((role === 'user' || role === 'assistant') && !metadata?.is_visually_hidden_from_conversation &&
        (!data?.recipient || data.recipient === 'all')) {
      const parts = array(record(data?.content)?.parts);
      const content = parts.filter((part): part is string => typeof part === 'string')
        .join('\n\n').replace(/\uE200[^\uE201]*\uE201/g, '').trim();
      const images = imagesFor(parts, metadata);
      if (content || images.length) turns.push({ id: string(data?.id) ?? cursor, message: { role, content }, images });
    }
    if (node.parent === null) break;
    cursor = string(node.parent);
    if (!cursor) return null;
  }
  return turns.length ? turns.reverse() : null;
}

function blobData(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function downloadEmbeddedImage(url: URL, apiFetch: ApiFetch): Promise<string> {
  try {
    const response = url.origin === origin
      ? await apiFetch(url.pathname + url.search, 'image/*')
      : await fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (response.ok) {
      const blob = await response.blob();
      if (blob.type.startsWith('image/') && blob.size) return await blobData(blob);
    }
  } catch {
    // A signed CDN URL may reject the content script's origin.
  }
  if (url.origin === origin || !globalThis.chrome?.runtime) return '';
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(''), 10_000);
    chrome.runtime.sendMessage({ action: 'FETCH_IMAGE_BASE64', url: url.href }, result => {
      clearTimeout(timer);
      void chrome.runtime.lastError;
      resolve(result?.base64 ?? '');
    });
  });
}

async function getImage(
  base: string,
  image: Attachment,
  apiFetch: ApiFetch
): Promise<AttachedFile | null> {
  const conversationId = base.split('/').at(-1)!;
  const id = encodeURIComponent(image.id);
  for (const path of [
    `${base}/attachment/${id}/download`,
    `/backend-api/files/download/${id}?conversation_id=${conversationId}&inline=true`,
  ]) {
    try {
      const result = await apiFetch(path);
      if (!result.ok) continue;
      const data = record(await result.json());
      const download = string(data?.download_url);
      if (!download) continue;
      const url = new URL(download, origin);
      if (url.protocol !== 'https:' || url.username || url.password ||
          (url.origin !== origin && !url.hostname.endsWith('.oaiusercontent.com'))) continue;
      const content = await downloadEmbeddedImage(url, apiFetch);
      const mime = /^data:(image\/[\w.+-]+);base64,.+/.exec(content)?.[1];
      if (!mime) continue;
      const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/svg+xml' ? 'svg' : mime.slice(6);
      const originalName = image.name || string(data?.file_name)?.split(/[\\/]/).at(-1) || `image.${extension}`;
      return { name: originalName, type: mime, content };
    } catch {
      // Try the other download endpoint for the same file in this conversation.
    }
  }
  return null;
}

function uniqueImageName(name: string, used: Set<string>): string {
  const safeName = name.replace(/[\\/]/g, '_');
  let candidate = safeName;
  const dot = safeName.lastIndexOf('.');
  const base = dot > 0 ? safeName.slice(0, dot) : safeName;
  const extension = dot > 0 ? safeName.slice(dot) : '';
  for (let i = 2; used.has(candidate); i++) candidate = `${base}-${i}${extension}`;
  used.add(candidate);
  return candidate;
}

export async function readChatGPTHistory(
  sourceUrl: string,
  visible: ReadonlyMap<string, Message>,
  assertSameConversation: () => void,
  onProgress?: Progress
): Promise<History | null> {
  const url = new URL(sourceUrl);
  const id = /\/c\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/?$/i.exec(url.pathname)?.[1];
  if (url.origin !== origin || !id) return null;

  const base = `/backend-api/conversation/${id}`;
  let token: string | undefined;
  let authorization: Promise<string | undefined> | undefined;
  const request: ApiFetch = (path, accept = 'application/json') => fetch(new URL(path, origin), {
    credentials: 'same-origin',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: accept, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const apiFetch: ApiFetch = async (path, accept) => {
    const sentWithToken = !!token;
    const response = await request(path, accept);
    if (sentWithToken || !([401, 403].includes(response.status) || (path === base && response.status === 404))) return response;
    authorization ??= request('/api/auth/session').then(async session =>
      session.ok ? string(record(await session.json())?.accessToken) : undefined
    );
    token = await authorization;
    return token ? request(path, accept) : response;
  };
  onProgress?.(0, 1, 'Loading the full ChatGPT conversation…');
  let turns: Turn[] | null;
  try {
    const response = await apiFetch(base);
    if (!response.ok) return null;
    turns = readTurns(await response.json(), id);
  } catch {
    return null;
  }
  assertSameConversation();

  // A locally selected branch or an in-progress reply may differ from the server view.
  const roles = new Map(turns?.map(turn => [turn.id, turn.message.role]));
  if (!turns || [...visible].some(([id, message]) => roles.get(id) !== message.role)) return null;

  const attachments = new Map<string, Attachment>();
  for (const turn of turns) {
    for (const image of turn.images) {
      if (!attachments.has(image.id)) attachments.set(image.id, image);
    }
  }
  const pending = [...attachments.values()];
  const downloads = new Map<string, AttachedFile | null>();
  let processed = 0;
  if (pending.length) onProgress?.(0, pending.length, 'Checking attachments…');
  // Use a small batch to cut per-file wait time without flooding ChatGPT.
  for (let start = 0; start < pending.length; start += 4) {
    assertSameConversation();
    await Promise.all(pending.slice(start, start + 4).map(async image => {
      downloads.set(image.id, await getImage(base, image, apiFetch));
      processed++;
      onProgress?.(processed, pending.length, 'Checking attachments…');
    }));
  }
  const filenames = new Set<string>();
  let missingImageCount = 0;
  for (const turn of turns) {
    const mounted = visible.get(turn.id);
    if (mounted?.content) turn.message.content = mounted.content;
    for (const image of turn.images) {
      const file = downloads.get(image.id);
      if (file) {
        (turn.message.files ??= []).push({ ...file, name: uniqueImageName(file.name, filenames) });
      } else {
        missingImageCount++;
      }
    }
    for (const file of mounted?.files ?? []) {
      if (!turn.message.files?.some(existing => existing.name === file.name)) (turn.message.files ??= []).push(file);
    }
  }
  assertSameConversation();
  return { messages: turns.map(turn => turn.message), missingImageCount };
}
