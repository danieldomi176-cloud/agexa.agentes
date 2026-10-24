/** Signed protocol tests against a local injected handler, never the real Base44 app. */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { ConversionFact } from '../../core/src/conversion.js';
import { createFeedHandler } from '../../integrations/base44/feedHandler.js';
import { readConversionFeed } from '../../integrations/base44/feedReader.js';
import type { FeedTransport, SignedResponse } from '../src/agexa/conversion/connector.js';
import { AgexaBase44Connector } from '../src/agexa/conversion/connector.js';
import { sign } from '../src/agexa/conversion/contract.js';
import { SalesEngine } from '../src/agexa/engine.js';
const SECRET = 'TEST-ONLY-key-with-no-real-deployment-value';
let root: string, engine: SalesEngine;
let facts: ConversionFact[];
let reads: number;
let mutate: ((r: SignedResponse) => SignedResponse) | undefined;
let handlerSecret = SECRET;
function company() {
  const s = engine.crm.createSource({
    name: 'Fixture authorized',
    kind: 'manual',
    url: null,
    termsUrl: null,
    permissionEvidence: 'Unit fixture',
    attribution: 'TEST',
    enabled: true,
    termsReviewed: true,
    commercialReuseAllowed: true,
  });
  return engine.crm.importCompanies(
    [
      {
        name: 'FICTÍCIO — fixture de protocolo',
        city: 'Beira',
        contactChannel: 'whatsapp',
        businessContact: '258840000001',
      },
    ],
    s.id,
    'fixture',
    'provided',
  ).companyIds[0];
}
const transport: FeedTransport = async (url, body, headers) => {
  const handler = createFeedHandler({
    appId: 'app-fixture',
    secret: handlerSecret,
    read: async () => {
      reads++;
      return { events: facts, nextCursor: 'cursor-fixture' };
    },
  });
  const response = await handler(new Request(url, { method: 'POST', body, headers }));
  const r = {
    body: await response.text(),
    status: response.status,
    headers: (() => {
      const result: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        result[key] = value;
      });
      return result;
    })(),
  };
  return mutate ? mutate(r) : r;
};
function configure(connector = new AgexaBase44Connector(transport)) {
  engine = new SalesEngine(root, undefined, undefined, connector);
  engine.conversion.configure({
    ...engine.conversion.store.config(),
    appId: 'app-fixture',
    endpoint: 'https://authorized.example.org/functions/feed',
    syncMode: 'on_demand',
    permissionEvidence: 'TEST authorized read-only backend function',
  });
}
function reference(id: string) {
  const c = engine.messaging.store.receive('web_experimental', false, {
    id: randomUUID(),
    remoteId: '258840000001@c.us',
    name: 'TEST FIXTURE',
    body: 'Inbound fixture only',
  })!.conversation;
  engine.messaging.link(c.id, id);
  engine.saveKnowledge({
    signupUrl: 'https://cadastro.example.org/',
    trialAvailable: true,
    trialDays: 7,
    confirmedFeatures: [],
    approvedPrices: [],
    policies: [],
  });
  engine.conversion.prepareLink(c.id, 'https://cadastro.example.org/');
  return String(
    engine.conversion.store.db
      .prepare('SELECT id FROM conversion_references ORDER BY rowid DESC LIMIT 1')
      .get()!.id,
  );
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'base44-protocol-test-'));
  facts = [];
  reads = 0;
  mutate = undefined;
  handlerSecret = SECRET;
  vi.stubEnv('AGEXA_BASE44_EVENT_SECRET', SECRET);
  configure();
});
afterEach(() => {
  engine.close();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
it('authenticates the minimal function and assigns a signed registration by an exact opaque reference', async () => {
  const id = company();
  facts = [
    {
      eventId: 'source-event-1',
      appId: 'app-fixture',
      kind: 'account_created',
      occurredAt: new Date().toISOString(),
      accountId: 'source-account',
      reference: reference(id),
      evidence: 'Signed domain fixture',
    },
  ];
  expect(await engine.conversion.sync()).toMatchObject({ received: 1, duplicates: 0 });
  expect(engine.crm.company(id).stage).toBe('account');
  expect(engine.conversion.snapshot().metrics.origins.integration.accounts).toBe(1);
  expect(engine.conversion.store.events().items[0]).toMatchObject({
    attribution: 'exact_reference',
    origin: 'integration',
    status: 'applied',
  });
  expect(JSON.stringify(engine.snapshot())).not.toContain(SECRET);
});
it('replays a signed feed idempotently without duplicate registrations or notifications', async () => {
  const id = company();
  facts = [
    {
      eventId: 'source-event-1',
      appId: 'app-fixture',
      kind: 'account_created',
      occurredAt: new Date().toISOString(),
      accountId: 'source-account',
      reference: reference(id),
      evidence: 'Fixture',
    },
  ];
  await engine.conversion.sync();
  const notice = engine.conversion.snapshot().notices[0].id;
  expect(await engine.conversion.sync()).toMatchObject({ duplicates: 1 });
  expect(engine.conversion.snapshot().accounts).toHaveLength(1);
  expect(engine.conversion.snapshot().notices[0].id).toBe(notice);
});
it('rejects authentication failure before executing any elevated domain query', async () => {
  handlerSecret = 'DIFFERENT-test-only-backend-secret-000';
  await expect(engine.conversion.sync()).rejects.toThrow(/recusou/);
  expect(reads).toBe(0);
  expect(engine.conversion.store.integration().cursor).toBeNull();
});
it('rejects tampered responses without advancing cursor or applying partial data', async () => {
  mutate = (r) => ({ ...r, body: r.body.replace('app-fixture', 'other-app') });
  await expect(engine.conversion.sync()).rejects.toThrow(/Autenticação/);
  expect(engine.conversion.store.integration().cursor).toBeNull();
  expect(engine.conversion.snapshot().accounts).toHaveLength(0);
});
it('rejects response nonce replay from a different synchronization', async () => {
  mutate = (r) => ({
    ...r,
    headers: { ...r.headers, 'x-agexa-nonce': 'replayed-nonce-000000000000' },
  });
  await expect(engine.conversion.sync()).rejects.toThrow(/replay/);
});
it('rejects an old response even if its HMAC is valid', async () => {
  mutate = (r) => {
    const stamp = String(Date.now() - 600000);
    return {
      ...r,
      headers: {
        ...r.headers,
        'x-agexa-timestamp': stamp,
        'x-agexa-signature': sign(SECRET, stamp, r.headers['x-agexa-nonce'], r.body),
      },
    };
  };
  await expect(engine.conversion.sync()).rejects.toThrow(/timestamp/);
});
it('rejects a batch containing an invalid payment without applying its otherwise-valid registration', async () => {
  const id = company();
  facts = [
    {
      eventId: 'good',
      appId: 'app-fixture',
      kind: 'account_created',
      occurredAt: new Date().toISOString(),
      accountId: 'a',
      reference: reference(id),
      evidence: 'Fixture',
    },
    {
      eventId: 'bad',
      appId: 'app-fixture',
      kind: 'payment_confirmed',
      occurredAt: new Date().toISOString(),
      accountId: 'a',
      evidence: 'Not verified',
    },
  ];
  // The hardened function now refuses invalid domain facts. Inject a malicious,
  // correctly signed response to retain the Office atomic-batch rejection check.
  const invalidFacts = facts;
  facts = [];
  mutate = (response) => {
    const payload = JSON.parse(response.body);
    payload.events = invalidFacts;
    const body = JSON.stringify(payload);
    return {
      ...response,
      body,
      headers: {
        ...response.headers,
        'x-agexa-signature': sign(
          SECRET,
          response.headers['x-agexa-timestamp'],
          response.headers['x-agexa-nonce'],
          body,
        ),
      },
    };
  };
  await expect(engine.conversion.sync()).rejects.toThrow(/Pagamento/);
  expect(engine.conversion.snapshot().accounts).toHaveLength(0);
  expect(engine.conversion.store.events().total).toBe(0);
});
it('keeps authenticated but unattributed events pending until an audited CEO association', async () => {
  const id = company();
  facts = [
    {
      eventId: 'unattributed',
      appId: 'app-fixture',
      kind: 'account_created',
      occurredAt: new Date().toISOString(),
      accountId: 'account-unknown',
      evidence: 'Fixture',
    },
  ];
  await engine.conversion.sync();
  const e = engine.conversion.store.events().items[0];
  expect(e.status).toBe('pending');
  engine.conversion.resolve(e.id, id, 'TEST: associação confirmada com evidência');
  expect(engine.conversion.store.events().items[0]).toMatchObject({
    origin: 'integration',
    attribution: 'ceo',
    status: 'applied',
  });
});
it('prevents a simulated connector from writing real-company facts', async () => {
  engine.close();
  configure(new AgexaBase44Connector(transport, true));
  const id = company();
  facts = [
    {
      eventId: 'simulated',
      appId: 'app-fixture',
      kind: 'account_created',
      occurredAt: new Date().toISOString(),
      accountId: 'a',
      reference: reference(id),
      evidence: 'Fixture',
    },
  ];
  await expect(engine.conversion.sync()).rejects.toThrow(/simulado/);
  expect(engine.conversion.snapshot().accounts).toHaveLength(0);
});
it('marks a sync interrupted after restart and never replays it automatically', async () => {
  engine.close();
  let started = false;
  const blocked: FeedTransport = async (_url, _body, _headers, signal) => {
    started = true;
    return new Promise((_r, reject) =>
      signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }),
    );
  };
  configure(new AgexaBase44Connector(blocked));
  const pending = engine.conversion.sync().catch((e) => e);
  expect(started).toBe(true);
  engine.close();
  await pending;
  configure();
  expect(
    engine.conversion.store.db
      .prepare('SELECT status FROM conversion_sync_runs ORDER BY rowid DESC LIMIT 1')
      .get()?.status,
  ).toBe('interrupted');
  expect(reads).toBe(0);
});
it('rejects insecure endpoint URLs and private-network literals before transport', () => {
  for (const endpoint of [
    'http://public.example.org',
    'https://127.0.0.1/',
    'https://metadata.google.internal/',
    'https://user:password@example.org/',
  ])
    expect(() =>
      engine.conversion.configure({ ...engine.conversion.store.config(), endpoint }),
    ).toThrow();
});
it('refuses this proxy rather than bypassing it for an external function request', async () => {
  engine.close();
  configure(new AgexaBase44Connector());
  vi.stubEnv('HTTPS_PROXY', 'http://restricted-proxy.invalid');
  await expect(engine.conversion.sync()).rejects.toThrow(/proxy/);
  expect(engine.conversion.store.integration().cursor).toBeNull();
});
it('enforces durable synchronization quotas', async () => {
  const db = engine.conversion.store.db;
  for (let i = 0; i < 30; i++)
    db.prepare('INSERT INTO conversion_sync_runs VALUES (?,?,?,?,?,?)').run(
      randomUUID(),
      'completed',
      new Date().toISOString(),
      new Date().toISOString(),
      null,
      null,
    );
  await expect(engine.conversion.sync()).rejects.toThrow(/30 sincronizações/);
  expect(reads).toBe(0);
});
it('denies unsigned function calls and wrong app scope without querying the app', async () => {
  const handler = createFeedHandler({
    appId: 'app-fixture',
    secret: SECRET,
    read: async () => {
      throw Error('Must not query');
    },
  });
  expect(
    (await handler(new Request('https://fixture.example.org', { method: 'GET' }))).status,
  ).toBe(405);
  expect(
    (await handler(new Request('https://fixture.example.org', { method: 'POST', body: '{}' })))
      .status,
  ).toBe(401);
  const nonce = randomUUID(),
    stamp = String(Date.now()),
    body = JSON.stringify({ appId: 'other-app', cursor: null, limit: 100, nonce });
  const r = await handler(
    new Request('https://fixture.example.org', {
      method: 'POST',
      body,
      headers: {
        'X-Agexa-Nonce': nonce,
        'X-Agexa-Timestamp': stamp,
        'X-Agexa-Signature': sign(SECRET, stamp, nonce, body),
      },
    }),
  );
  expect(r.status).toBe(400);
});
it('persists an SDK page cursor across restart and cycles safely to later domain events', async () => {
  engine.close();
  const pages = [
    {
      items: [
        {
          payload: {
            eventId: 'page-1',
            appId: 'app-fixture',
            kind: 'account_created',
            occurredAt: new Date().toISOString(),
            accountId: 'page-account-1',
            evidence: 'TEST domain event',
          },
        },
      ],
      next_cursor: 'sdk-page-2',
    },
    {
      items: [
        {
          payload: {
            eventId: 'page-2',
            appId: 'app-fixture',
            kind: 'account_created',
            occurredAt: new Date().toISOString(),
            accountId: 'page-account-2',
            evidence: 'TEST domain event',
          },
        },
      ],
      next_cursor: null,
    },
  ];
  const options: unknown[] = [];
  const entity = {
    list: async (input: { cursor?: string }) => {
      options.push(input);
      return input.cursor ? pages[1] : pages[0];
    },
  };
  const paged: FeedTransport = async (url, body, headers) => {
    const handler = createFeedHandler({
      appId: 'app-fixture',
      secret: SECRET,
      read: (cursor, limit) => readConversionFeed(entity, 'app-fixture', cursor, limit),
    });
    const response = await handler(new Request(url, { method: 'POST', body, headers }));
    return {
      status: response.status,
      body: await response.text(),
      headers: (() => {
        const result: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          result[key] = value;
        });
        return result;
      })(),
    };
  };
  configure(new AgexaBase44Connector(paged));
  await engine.conversion.sync();
  const cursor = engine.conversion.store.integration().cursor;
  engine.close();
  // Re-open without configure(): configuration must not reset the saved cursor.
  engine = new SalesEngine(root, undefined, undefined, new AgexaBase44Connector(paged));
  expect(engine.conversion.store.integration().cursor).toBe(cursor);
  await engine.conversion.sync();
  expect(options[1]).toEqual({ cursor: 'sdk-page-2', limit: 100 });
  expect(engine.conversion.store.events().total).toBe(2);
  // Finished snapshot restarts; stable IDs are counted as duplicates, not conversions.
  expect(await engine.conversion.sync()).toMatchObject({ duplicates: 1 });
  expect(options[2]).toEqual({ sort: 'created_date', fields: ['payload'], limit: 100 });
  expect(engine.conversion.store.events().total).toBe(2);
  expect(engine.conversion.snapshot().metrics.pendingEvents).toBe(2);
});
it.each(['network', 'http503', 'http404'])(
  'preserves ledger and cursor after %s transport failure',
  async (mode) => {
    const before = engine.conversion.store.events().total;
    const failing: FeedTransport = async () => {
      if (mode === 'network') throw Error('TEST network unavailable');
      return { status: mode === 'http503' ? 503 : 404, body: 'TEST unavailable', headers: {} };
    };
    engine.close();
    configure(new AgexaBase44Connector(failing));
    await expect(engine.conversion.sync()).rejects.toThrow();
    expect(engine.conversion.store.events().total).toBe(before);
    expect(engine.conversion.store.integration().cursor).toBeNull();
    expect(engine.conversion.store.integration().status).toBe('error');
  },
);
it('exposes only safe key readiness in the snapshot and never raw HMAC material', () => {
  const snapshot = engine.conversion.snapshot();
  expect(snapshot.integration).toMatchObject({ secretConfigured: true, secretStatus: 'ready' });
  expect(JSON.stringify(snapshot)).not.toContain(SECRET);
});
