/** Shared read-only function handler. Deploy inside the authorized Base44 app. */
import type { ConversionFact } from '../../core/src/conversion.js';
import { validateFact } from '../../core/src/conversionContract.js';
export type FeedEvent = ConversionFact;
export interface FeedDependencies {
  appId: string;
  secret: string;
  read: (
    cursor: string | null,
    limit: number,
  ) => Promise<{ events: FeedEvent[]; nextCursor: string | null }>;
  now?: () => number;
}
const encoder = new TextEncoder();
async function signature(
  secret: string,
  stamp: string,
  nonce: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const result = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(stamp + '\n' + nonce + '\n' + body),
  );
  return Array.from(new Uint8Array(result))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export function createFeedHandler(deps: FeedDependencies): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (deps.secret.length < 32 || !deps.appId)
      return new Response('Integration not configured', { status: 503 });
    const stamp = req.headers.get('X-Agexa-Timestamp') ?? '',
      nonce = req.headers.get('X-Agexa-Nonce') ?? '',
      sig = req.headers.get('X-Agexa-Signature') ?? '';
    if (
      !/^\d{10,13}$/.test(stamp) ||
      Math.abs((deps.now?.() ?? Date.now()) - Number(stamp)) > 300000 ||
      !/^[-A-Za-z0-9]{20,100}$/.test(nonce) ||
      !/^[a-f0-9]{64}$/.test(sig)
    )
      return new Response('Unauthorized', { status: 401 });
    const reader = req.body?.getReader();
    if (!reader) return new Response('Invalid request', { status: 400 });
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > 8192) {
        await reader.cancel();
        return new Response('Request too large', { status: 413 });
      }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const raw = new TextDecoder().decode(bytes);
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(deps.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const signatureBytes = new Uint8Array(sig.match(/../g)!.map((h) => parseInt(h, 16)));
    if (
      !(await crypto.subtle.verify(
        'HMAC',
        key,
        signatureBytes,
        encoder.encode(stamp + '\n' + nonce + '\n' + raw),
      ))
    )
      return new Response('Unauthorized', { status: 401 });
    let input: { appId: string; cursor: string | null; limit: number; nonce: string };
    try {
      input = JSON.parse(raw);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      input.appId !== deps.appId ||
      input.nonce !== nonce ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      !(
        input.cursor === null ||
        (typeof input.cursor === 'string' && input.cursor.length <= 2000)
      ) ||
      Object.keys(input).some((k) => !['appId', 'cursor', 'limit', 'nonce'].includes(k))
    )
      return new Response('Invalid contract', { status: 400 });
    try {
      const feed = await deps.read(input.cursor, input.limit);
      if (
        !Array.isArray(feed.events) ||
        feed.events.length > input.limit ||
        !(
          feed.nextCursor === null ||
          (typeof feed.nextCursor === 'string' && feed.nextCursor.length <= 2000)
        ) ||
        feed.events.some((e) => validateFact(e, deps.now?.() ?? Date.now()).appId !== deps.appId)
      )
        return new Response('Invalid domain feed', { status: 500 });
      const body = JSON.stringify({
        appId: deps.appId,
        nonce,
        events: feed.events,
        nextCursor: feed.nextCursor,
      });
      if (encoder.encode(body).byteLength > 262144)
        return new Response('Feed too large', { status: 500 });
      const responseStamp = String(deps.now?.() ?? Date.now());
      return new Response(body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Agexa-Timestamp': responseStamp,
          'X-Agexa-Nonce': nonce,
          'X-Agexa-Signature': await signature(deps.secret, responseStamp, nonce, body),
        },
      });
    } catch {
      return new Response('Domain feed unavailable', { status: 503 });
    }
  };
}
