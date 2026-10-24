/** Domain-separated protocol: this key MUST differ from conversion-feed HMAC. */
export const CEO_PATH = '/api/ceo/v1/request';
export const CEO_MAX_REQUEST = 32768;
export const CEO_MAX_RESPONSE = 1048576;
export const CEO_WINDOW_MS = 90000;
const encoder = new TextEncoder();
export async function ceoSignature(
  secret: string,
  direction: 'request' | 'response',
  stamp: string,
  nonce: string,
  raw: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`AGEXA-CEO-V1\n${direction}\nPOST\n${CEO_PATH}\n${stamp}\n${nonce}\n${raw}`),
  );
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function ceoVerify(
  secret: string,
  direction: 'request' | 'response',
  stamp: string,
  nonce: string,
  raw: string,
  signature: string,
  now = Date.now(),
): Promise<boolean> {
  if (
    !/^\d{13}$/.test(stamp) ||
    Math.abs(now - Number(stamp)) > CEO_WINDOW_MS ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const bytes = new Uint8Array(signature.match(/../g)!.map((value) => parseInt(value, 16)));
  return crypto.subtle.verify(
    'HMAC',
    key,
    bytes,
    encoder.encode(`AGEXA-CEO-V1\n${direction}\nPOST\n${CEO_PATH}\n${stamp}\n${nonce}\n${raw}`),
  );
}
export async function boundedText(response: Response | Request, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw Error('Missing body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > max) {
      await reader.cancel();
      throw Error('Body too large');
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
