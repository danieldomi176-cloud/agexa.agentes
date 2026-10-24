/** Isolated SDK/entity fixtures only. These tests do not authenticate or deploy to Base44. */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import type { ConversionFact } from '../../core/src/conversion.js';
import { createFeedHandler } from '../../integrations/base44/feedHandler.js';
import type { FeedEntityReader } from '../../integrations/base44/feedReader.js';
import { readConversionFeed } from '../../integrations/base44/feedReader.js';
import {
  captureCommercialReference,
  publishConversionEvent,
} from '../../integrations/base44/publishConversionEvent.js';
import { sign } from '../src/agexa/conversion/contract.js';
import { readBase44Secret } from '../src/agexa/conversion/secret.js';

const SECRET = 'TEST-ONLY-not-a-real-base44-deployment-key';
const APP = 'fixture-app';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fact(id = 'event-1'): ConversionFact {
  return {
    appId: APP,
    eventId: id,
    accountId: 'account-1',
    kind: 'account_created',
    occurredAt: '2026-01-01T12:00:00.000Z',
    evidence: 'TEST authorized domain receipt',
  };
}
function secretFile(value = SECRET) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'base44-raw-secret-test-'));
  roots.push(root);
  const file = path.join(root, 'secret');
  fs.writeFileSync(file, value, { mode: 0o600 });
  return file;
}
it('distinguishes missing, short and usable raw backend keys without trimming them', () => {
  expect(readBase44Secret({})).toEqual({ status: 'missing', value: '' });
  expect(readBase44Secret({ AGEXA_BASE44_EVENT_SECRET: 'short' }).status).toBe('invalid');
  expect(readBase44Secret({ AGEXA_BASE44_EVENT_SECRET: SECRET })).toEqual({
    status: 'ready',
    value: SECRET,
  });
  expect(readBase44Secret({ AGEXA_BASE44_EVENT_SECRET: SECRET + '\n' }).status).toBe('invalid');
});
it('reads the exact private mounted key and rejects ambiguous sources', () => {
  const file = secretFile();
  expect(readBase44Secret({ AGEXA_BASE44_EVENT_SECRET_FILE: file })).toEqual({
    status: 'ready',
    value: SECRET,
  });
  expect(
    readBase44Secret({ AGEXA_BASE44_EVENT_SECRET_FILE: file, AGEXA_BASE44_EVENT_SECRET: SECRET }),
  ).toEqual({ status: 'invalid', value: '' });
});
it('rejects group-readable, symbolic, relative and absent secret files safely', () => {
  const file = secretFile();
  const link = file + '.link';
  fs.symlinkSync(file, link);
  for (const name of [link, './secret', file + '.missing'])
    expect(readBase44Secret({ AGEXA_BASE44_EVENT_SECRET_FILE: name })).toEqual({
      status: 'invalid',
      value: '',
    });
  fs.chmodSync(file, 0o640);
  expect(readBase44Secret({ AGEXA_BASE44_EVENT_SECRET_FILE: file }).status).toBe('invalid');
});
it('rejects oversized, newline-terminated and invalid UTF-8 key files', () => {
  for (const value of [SECRET + '\n', 'x'.repeat(4097)])
    expect(readBase44Secret({ AGEXA_BASE44_EVENT_SECRET_FILE: secretFile(value) }).status).toBe(
      'invalid',
    );
  const file = secretFile();
  fs.writeFileSync(file, Buffer.from([0xff, ...Buffer.from(SECRET)]));
  expect(readBase44Secret({ AGEXA_BASE44_EVENT_SECRET_FILE: file }).status).toBe('invalid');
});
it('continues SDK cursor walks without resending incompatible sort or fields', async () => {
  const list = vi
    .fn<FeedEntityReader['list']>()
    .mockResolvedValueOnce({ items: [{ payload: fact() }], next_cursor: 'snapshot-page-2' })
    .mockResolvedValueOnce({ items: [{ payload: fact('event-2') }], next_cursor: null });
  const first = await readConversionFeed({ list }, APP, null, 1);
  expect(list).toHaveBeenNthCalledWith(1, { sort: 'created_date', fields: ['payload'], limit: 1 });
  await readConversionFeed({ list }, APP, first.nextCursor, 1);
  expect(list).toHaveBeenNthCalledWith(2, { cursor: 'snapshot-page-2', limit: 1 });
});
it('persists a restart token so later inserts are seen on the next explicit walk', async () => {
  const list = vi
    .fn<FeedEntityReader['list']>()
    .mockResolvedValueOnce({ items: [{ payload: fact() }], next_cursor: null })
    .mockResolvedValueOnce({
      items: [{ payload: fact() }, { payload: fact('new-event') }],
      next_cursor: null,
    });
  const first = await readConversionFeed({ list }, APP, null, 100);
  expect(first.nextCursor).toBeTypeOf('string');
  const next = await readConversionFeed({ list }, APP, first.nextCursor, 100);
  expect(next.events.map((e) => e.eventId)).toEqual(['event-1', 'new-event']);
  expect(list).toHaveBeenLastCalledWith({ sort: 'created_date', fields: ['payload'], limit: 100 });
});
it('rejects malformed and cross-app cursors before reading any privileged entity', async () => {
  const list = vi
    .fn<FeedEntityReader['list']>()
    .mockResolvedValue({ items: [], next_cursor: null });
  const other = await readConversionFeed({ list }, 'other-app', null, 1);
  list.mockClear();
  for (const cursor of ['bogus', 'v1.!', other.nextCursor])
    await expect(readConversionFeed({ list }, APP, cursor, 1)).rejects.toThrow();
  expect(list).not.toHaveBeenCalled();
});
it('rejects invalid SDK pages, wrong-app facts and unknown browser data fields', async () => {
  for (const page of [
    { items: [{ payload: { ...fact(), appId: 'wrong' } }], next_cursor: null },
    { items: [{ payload: { ...fact(), email: 'fixture@example.org' } }], next_cursor: null },
    { items: [], next_cursor: 42 },
    { items: [{ payload: fact() }, { payload: fact() }], next_cursor: null },
  ]) {
    const list = vi.fn().mockResolvedValue(page);
    await expect(readConversionFeed({ list }, APP, null, 1)).rejects.toThrow();
  }
});
it('publishes stable domain events idempotently and refuses changed facts under the same ID', async () => {
  const items: { payload: ConversionFact }[] = [];
  const entity = {
    filter: vi.fn(async () => ({ items })),
    create: vi.fn(async (record: { payload: ConversionFact }) => {
      items.push(record);
    }),
  };
  expect(await publishConversionEvent(entity, APP, fact())).toEqual({ duplicate: false });
  expect(await publishConversionEvent(entity, APP, fact())).toEqual({ duplicate: true });
  expect(entity.create).toHaveBeenCalledTimes(1);
  expect(entity.filter.mock.calls.length).toBe(2);
  await expect(
    publishConversionEvent(entity, APP, { ...fact(), accountId: 'changed' }),
  ).rejects.toThrow(/conflict/);
});
it('rejects unverified payments and cross-app domain facts before source lookup or write', async () => {
  const entity = { filter: vi.fn(), create: vi.fn() };
  for (const input of [
    { ...fact(), kind: 'payment_confirmed', verified: false },
    { ...fact(), appId: 'wrong' },
  ])
    await expect(publishConversionEvent(entity, APP, input)).rejects.toThrow();
  expect(entity.filter).not.toHaveBeenCalled();
  expect(entity.create).not.toHaveBeenCalled();
});
it('accepts only an opaque generated commercial UUID as an attribution candidate', () => {
  const ref = randomUUID();
  expect(captureCommercialReference(ref.toUpperCase())).toBe(ref);
  for (const input of [null, '', 'fixture@example.org', 'admin', '7-days', ['id']])
    expect(captureCommercialReference(input)).toBeNull();
});
function request(
  overrides: {
    nonce?: string;
    stamp?: string;
    secret?: string;
    appId?: string;
    limit?: number;
  } = {},
) {
  const nonce = overrides.nonce ?? randomUUID(),
    stamp = overrides.stamp ?? String(Date.now());
  const body = JSON.stringify({
    appId: overrides.appId ?? APP,
    nonce,
    limit: overrides.limit ?? 100,
    cursor: null,
  });
  return new Request('https://fixture.example.org', {
    method: 'POST',
    body,
    headers: {
      'X-Agexa-Timestamp': stamp,
      'X-Agexa-Nonce': nonce,
      'X-Agexa-Signature': sign(overrides.secret ?? SECRET, stamp, nonce, body),
    },
  });
}
it('rejects old timestamps, invalid nonces and incorrect keys before elevated source access', async () => {
  const read = vi.fn().mockResolvedValue({ events: [], nextCursor: null });
  const handler = createFeedHandler({ appId: APP, secret: SECRET, read });
  for (const options of [
    { stamp: String(Date.now() - 600000) },
    { nonce: 'bad' },
    { secret: SECRET + 'wrong' },
  ])
    expect((await handler(request(options))).status).toBe(401);
  expect(read).not.toHaveBeenCalled();
});
it('never signs an invalid payment, extra personal field, wrong scope or oversized page', async () => {
  for (const events of [
    [{ ...fact(), kind: 'payment_confirmed', verified: false }],
    [{ ...fact(), phone: 'TEST-NOT-A-PHONE' }],
    [{ ...fact(), appId: 'wrong' }],
    [fact(), fact('event-2')],
  ]) {
    const handler = createFeedHandler({
      appId: APP,
      secret: SECRET,
      read: vi.fn().mockResolvedValue({ events, nextCursor: null }),
    });
    const response = await handler(request({ limit: 1 }));
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.headers.has('X-Agexa-Signature')).toBe(false);
    expect(await response.text()).not.toContain(SECRET);
  }
});
it('returns a bounded signed empty feed and generic source failures without leaking SDK details', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({ events: [], nextCursor: null })
    .mockRejectedValueOnce(Error('PRIVATE SDK DETAILS ' + SECRET));
  const handler = createFeedHandler({ appId: APP, secret: SECRET, read });
  const ok = await handler(request());
  expect(ok.status).toBe(200);
  const body = await ok.text();
  expect(ok.headers.get('X-Agexa-Signature')).toBe(
    sign(SECRET, ok.headers.get('X-Agexa-Timestamp')!, ok.headers.get('X-Agexa-Nonce')!, body),
  );
  const failure = await handler(request());
  expect(failure.status).toBe(503);
  expect(await failure.text()).toBe('Domain feed unavailable');
});
