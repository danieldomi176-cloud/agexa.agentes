/** INTERNAL domain helper, never a public endpoint or browser-authoritative event API. */
import type { ConversionFact } from '../../core/src/conversion.js';
import { validateFact } from '../../core/src/conversionContract.js';

export interface EventWriter {
  filter(
    query: { event_key: string },
    options: { limit: number },
  ): Promise<{ items: { payload: unknown }[] }>;
  create(record: { event_key: string; payload: ConversionFact }): Promise<unknown>;
}
const canonical = (fact: ConversionFact) => JSON.stringify(fact, Object.keys(fact).sort());
export function captureCommercialReference(value: unknown): string | null {
  // Attribution only. This must never change entitlements, prices or authorization.
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}
export async function publishConversionEvent(
  entity: EventWriter,
  appId: string,
  confirmedDomainFact: unknown,
): Promise<{ duplicate: boolean }> {
  const fact = validateFact(confirmedDomainFact);
  if (fact.appId !== appId) throw new Error('Invalid application scope');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([fact.appId, fact.eventId])),
  );
  const event_key = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  const existing = await entity.filter({ event_key }, { limit: 2 });
  if (!Array.isArray(existing.items) || existing.items.length > 2)
    throw new Error('Invalid domain lookup');
  if (existing.items.length) {
    if (existing.items.some((item) => canonical(validateFact(item.payload)) !== canonical(fact)))
      throw new Error('Stable event ID conflict');
    return { duplicate: true };
  }
  // Not an atomic uniqueness guarantee. Bind to the actual domain outbox/unique
  // constraint when available; concurrent copies remain deduplicated by Office.
  await entity.create({ event_key, payload: fact });
  return { duplicate: false };
}
