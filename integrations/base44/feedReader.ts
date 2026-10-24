import { validateFact } from '../../core/src/conversionContract.js';
import type { FeedEvent } from './feedHandler.js';

export interface FeedEntityReader {
  list(options: {
    sort?: string;
    fields?: string[];
    limit: number;
    cursor?: string;
  }): Promise<{ items: { payload: unknown }[]; next_cursor?: string | null }>;
}
function encode(appId: string, sdkCursor: string | null): string {
  const value = 'v1.' + btoa(JSON.stringify({ appId, sdkCursor }));
  if (value.length > 2000) throw new Error('Cursor too large');
  return value;
}
function decode(cursor: string | null, appId: string): string | null {
  if (cursor === null) return null;
  if (!cursor.startsWith('v1.') || cursor.length > 2000) throw new Error('Unsupported cursor');
  const value = JSON.parse(atob(cursor.slice(3)));
  if (
    !value ||
    value.appId !== appId ||
    Object.keys(value).some((k) => !['appId', 'sdkCursor'].includes(k)) ||
    !(
      value.sdkCursor === null ||
      (typeof value.sdkCursor === 'string' && value.sdkCursor.length > 0)
    )
  )
    throw new Error('Invalid cursor scope');
  return value.sdkCursor;
}
/** SDK 0.8.57 cursor pages carry the original query: do not repeat sort/fields. */
export async function readConversionFeed(
  entity: FeedEntityReader,
  appId: string,
  cursor: string | null,
  limit: number,
): Promise<{ events: FeedEvent[]; nextCursor: string }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid page limit');
  const sdkCursor = decode(cursor, appId);
  const page = await entity.list(
    sdkCursor ? { cursor: sdkCursor, limit } : { sort: 'created_date', fields: ['payload'], limit },
  );
  if (
    !page ||
    !Array.isArray(page.items) ||
    page.items.length > limit ||
    !(
      page.next_cursor === null ||
      page.next_cursor === undefined ||
      (typeof page.next_cursor === 'string' && page.next_cursor.length > 0)
    )
  )
    throw new Error('Invalid SDK page');
  const events = page.items.map((item) => {
    const fact = validateFact(item.payload);
    if (fact.appId !== appId) throw new Error('Invalid event scope');
    return fact;
  });
  // A finite SDK walk may not include later inserts. Persist a restart token on its
  // last page; next explicit sync begins another walk. Office deduplicates stable IDs.
  return { events, nextCursor: encode(appId, page.next_cursor ?? null) };
}
