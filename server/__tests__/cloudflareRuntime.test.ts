import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { authorized } from '../../cloudflare/src/access.js';
import {
  control,
  cycle,
  enqueue,
  type Env,
  snapshot,
  type Statement,
} from '../../cloudflare/src/runtime.js';
import { SalesEngine } from '../src/agexa/engine.js';
let root: string, engine: SalesEngine, env: Env, companyId: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-office-test-'));
  engine = new SalesEngine(root);
  const db = engine.conversion.store.db;
  db.exec(
    fs.readFileSync(path.join(process.cwd(), '../cloudflare/migrations/0001_runtime.sql'), 'utf8'),
  );
  class Query {
    constructor(
      readonly sql: string,
      readonly args: unknown[] = [],
    ) {}
    bind(...args: unknown[]) {
      return new Query(this.sql, args);
    }
    async first<T>() {
      return (db.prepare(this.sql).get(...(this.args as never[])) ?? null) as T | null;
    }
    async all<T>() {
      return { results: db.prepare(this.sql).all(...(this.args as never[])) as T[] };
    }
    async run() {
      return {
        meta: { changes: Number(db.prepare(this.sql).run(...(this.args as never[])).changes) },
      };
    }
  }
  env = {
    DB: {
      prepare: (sql) => new Query(sql),
      batch: async (statements: Statement[]) => {
        db.exec('BEGIN');
        try {
          const result = statements.map((s) => {
            const q = s as Query;
            return db.prepare(q.sql).run(...(q.args as never[]));
          });
          db.exec('COMMIT');
          return result;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
    },
    AI: {
      run: vi.fn(async () => ({
        response: JSON.stringify({
          summary: 'TEST internal draft',
          draft: '',
          observations: [],
          nextActions: [],
        }),
      })),
    },
    AUTONOMY_ENABLED: 'true',
    FREE_ACCOUNT_CONFIRMED: 'true',
    FREE_MODEL_CONFIRMED: 'true',
    AI_MODEL: 'TEST-only-injected-model',
    DAILY_CALLS: '10',
  };
  const source = engine.crm.createSource({
    name: 'TEST authorized source',
    kind: 'manual',
    url: null,
    termsUrl: null,
    permissionEvidence: 'TEST provided record',
    attribution: 'TEST',
    enabled: true,
    termsReviewed: true,
    commercialReuseAllowed: true,
  });
  companyId = engine.crm.importCompanies(
    [{ name: 'FICTÍCIO', website: 'https://example.org', city: 'Beira' }],
    source.id,
    'fixture',
    'provided',
  ).companyIds[0];
  for (const e of engine.snapshot().employees) engine.setEmployee(e.id, true);
});
afterEach(() => {
  engine.close();
  fs.rmSync(root, { recursive: true, force: true });
});
async function order(mode: 'research' | 'provided' = 'provided') {
  await enqueue(
    env,
    crypto.randomUUID(),
    companyId,
    'TEST authorized internal chain',
    mode,
    Date.now(),
  );
  await control(env, 'resume');
}
it('runs all eight persistent stages through the injected AI binding and updates only internal CRM follow-up', async () => {
  await order();
  for (let i = 0; i < 8; i++) expect(await cycle(env)).toBe('completed');
  const s = await snapshot(env);
  expect(s.tasks.filter((t) => t.status === 'completed')).toHaveLength(8);
  expect(s.budget[0].attempts).toBe(8);
  expect(engine.crm.company(companyId).stage).toBe('identified');
  expect(engine.crm.company(companyId).nextAction).toContain('Rever rascunho');
});
it('does nothing without explicit free-account/model configuration or when paused', async () => {
  await order();
  env.FREE_MODEL_CONFIRMED = 'false';
  expect(await cycle(env)).toBe('paused_or_unconfigured');
  env.FREE_MODEL_CONFIRMED = 'true';
  await control(env, 'pause');
  expect(await cycle(env)).toBe('paused_or_unconfigured');
  expect(env.AI.run).not.toHaveBeenCalled();
});
it('blocks research without inventing a network tool or consuming AI', async () => {
  await order('research');
  await cycle(env);
  expect(await cycle(env)).toBe('research_blocked');
  expect(env.AI.run).toHaveBeenCalledTimes(1);
});
it('enforces persistent daily call quotas including failures', async () => {
  await order();
  env.DAILY_CALLS = '1';
  await cycle(env);
  expect(await cycle(env)).toBe('quota');
  expect((await snapshot(env)).budget[0].attempts).toBe(1);
});
it('rejects duplicate human order IDs atomically', async () => {
  const id = crypto.randomUUID();
  await enqueue(env, id, companyId, 'TEST', 'provided', Date.now());
  await expect(enqueue(env, id, companyId, 'TEST', 'provided', Date.now())).rejects.toThrow();
  expect((await snapshot(env)).tasks).toHaveLength(8);
});
it('serializes overlapping cron executions using a durable lease', async () => {
  await order();
  let finish!: (v: unknown) => void;
  env.AI.run = vi.fn(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const pending = cycle(env);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(await cycle(env)).toBe('busy');
  finish({
    response: JSON.stringify({ summary: 'TEST', draft: '', observations: [], nextActions: [] }),
  });
  await pending;
  expect(env.AI.run).toHaveBeenCalledTimes(1);
});
it('discards an in-flight result after emergency stop', async () => {
  await order();
  let finish!: (v: unknown) => void;
  env.AI.run = () =>
    new Promise((r) => {
      finish = r;
    });
  const pending = cycle(env);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await control(env, 'stop');
  finish({
    response: JSON.stringify({ summary: 'TEST', draft: '', observations: [], nextActions: [] }),
  });
  expect(await pending).toBe('discarded');
  expect((await snapshot(env)).tasks.every((t) => t.status === 'cancelled')).toBe(true);
});
it('blocks malformed or failed AI output without silently retrying', async () => {
  await order();
  env.AI.run = vi.fn(async () => ({ response: 'not JSON' }));
  expect(await cycle(env)).toBe('blocked');
  expect(await cycle(env)).toBe('idle');
  expect(env.AI.run).toHaveBeenCalledTimes(1);
});
it('recovers an expired execution as uncertain rather than replaying it', async () => {
  await order();
  const db = engine.conversion.store.db;
  db.prepare(
    "UPDATE tasks SET status='running' WHERE id=(SELECT taskId FROM cf_jobs ORDER BY rowid LIMIT 1)",
  ).run();
  expect(await cycle(env)).toBe('idle');
  expect((await snapshot(env)).tasks.some((t) => String(t.error).includes('interrompida'))).toBe(
    true,
  );
});
it('requires a real verified Access JWT, issuer, audience and CEO subject', async () => {
  expect(await authorized(new Request('https://example.org'), {})).toBe(false);
  expect(
    await authorized(
      new Request('https://example.org', {
        headers: {
          'Cf-Access-Authenticated-User-Email': 'ceo@example.org',
          'Cf-Access-Jwt-Assertion': 'fake',
        },
      }),
      { ACCESS_TEAM: 'test', ACCESS_AUD: 'test', CEO_SUBJECTS: 'test' },
    ),
  ).toBe(false);
});
it('cryptographically validates an actual fixture Access JWT and rejects a different subject', async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const header = enc({ alg: 'RS256', kid: 'fixture' }),
    payload = enc({
      iss: 'https://fixture.cloudflareaccess.com',
      aud: ['aud'],
      sub: 'ceo',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    pair.privateKey,
    new TextEncoder().encode(header + '.' + payload),
  );
  const token = header + '.' + payload + '.' + Buffer.from(signature).toString('base64url');
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => Response.json({ keys: [{ ...jwk, kid: 'fixture' }] }));
  try {
    const request = new Request('https://private.example.org', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });
    expect(
      await authorized(request, { ACCESS_TEAM: 'fixture', ACCESS_AUD: 'aud', CEO_SUBJECTS: 'ceo' }),
    ).toBe(true);
    expect(
      await authorized(request, {
        ACCESS_TEAM: 'fixture',
        ACCESS_AUD: 'aud',
        CEO_SUBJECTS: 'other',
      }),
    ).toBe(false);
  } finally {
    globalThis.fetch = original;
  }
});
