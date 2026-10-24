/** Adapter tests inject a fake browser client; no real WhatsApp authentication. */
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { SalesEngine } from '../src/agexa/engine.js';
import type { WebClient } from '../src/agexa/messaging/experimental.js';
import { WhatsAppWebExperimentalProvider } from '../src/agexa/messaging/experimental.js';
import type { ProviderEvent } from '../src/agexa/messaging/provider.js';
import { WhatsAppCloudApiProvider } from '../src/agexa/messaging/provider.js';
const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-browser-fake-'));
  roots.push(root);
  const emitter = new EventEmitter();
  const initialize = vi.fn(async () => {}),
    destroy = vi.fn(async () => {}),
    logout = vi.fn(async () => {}),
    send = vi.fn(async () => ({ id: { _serialized: 'outbound-fixture' }, ack: 1 }));
  const client = Object.assign(emitter, {
    initialize,
    destroy,
    logout,
    sendMessage: send,
    info: { wid: { _serialized: '258840000099@c.us' } },
  }) as unknown as WebClient;
  const provider = new WhatsAppWebExperimentalProvider(path.join(root, 'auth'), async () => client);
  return { root, emitter, provider, initialize, destroy, logout, send };
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it('emits refreshed QR, authenticated/ready state and account without storing QR', async () => {
  const f = fixture();
  const events: ProviderEvent[] = [];
  f.provider.on('event', (e) => events.push(e));
  await f.provider.connect();
  f.emitter.emit('qr', 'QR-TEST-1');
  f.emitter.emit('qr', 'QR-TEST-2');
  f.emitter.emit('authenticated');
  f.emitter.emit('ready');
  expect(events.filter((e) => e.type === 'qr')).toHaveLength(2);
  expect(events.at(-1)).toMatchObject({
    type: 'state',
    status: 'connected',
    account: '258840000099',
  });
  expect(fs.statSync(f.provider.sessionPath).mode & 0o777).toBe(0o700);
  expect(fs.readdirSync(f.provider.sessionPath)).toHaveLength(0);
  await f.provider.disconnect();
});
it('disconnects preserving LocalAuth and explicitly revokes the known local session', async () => {
  const f = fixture();
  await f.provider.connect();
  const session = path.join(f.provider.sessionPath, 'session-agexa-test');
  fs.mkdirSync(session);
  fs.writeFileSync(path.join(session, 'fixture'), 'TEST-ONLY');
  await f.provider.disconnect();
  expect(fs.existsSync(session)).toBe(true);
  await f.provider.connect();
  await f.provider.disconnect(true);
  expect(f.logout).toHaveBeenCalledOnce();
  expect(fs.existsSync(session)).toBe(false);
  expect(f.initialize).toHaveBeenCalledTimes(2);
});
it('reports authentication/disconnection errors and prohibits send before ready', async () => {
  const f = fixture();
  const events: ProviderEvent[] = [];
  f.provider.on('event', (e) => events.push(e));
  await f.provider.connect();
  await expect(f.provider.send('258840000001@c.us', 'Test')).rejects.toThrow(/ligado/);
  f.emitter.emit('auth_failure', 'secret-provider-error-not-for-logs');
  expect(events.at(-1)).toMatchObject({ type: 'error' });
  expect(JSON.stringify(events)).not.toContain('secret-provider-error');
  f.emitter.emit('disconnected');
  expect(events.at(-1)).toMatchObject({ type: 'state', status: 'disconnected' });
  await f.provider.disconnect();
});
it('accepts only individual text messages, detects best-effort human events, and documents unreliable automation', async () => {
  const f = fixture();
  const events: ProviderEvent[] = [];
  f.provider.on('event', (e) => events.push(e));
  await f.provider.connect();
  f.emitter.emit('ready');
  f.emitter.emit('message', {
    fromMe: false,
    from: 'group@g.us',
    type: 'chat',
    body: 'Group',
    id: { _serialized: 'group' },
  });
  f.emitter.emit('message', {
    fromMe: false,
    from: '258840000001@c.us',
    type: 'chat',
    body: 'Question',
    id: { _serialized: 'inbound' },
  });
  f.emitter.emit('message_create', {
    fromMe: true,
    to: '258840000001@c.us',
    body: 'Human',
    id: { _serialized: 'human' },
  });
  expect(events.filter((e) => e.type === 'message')).toHaveLength(1);
  expect(events.filter((e) => e.type === 'human')).toHaveLength(1);
  expect(f.provider.capabilities).toMatchObject({
    automatic: false,
    reliableHumanDetection: false,
    history: false,
  });
  await expect(f.provider.send('group@g.us', 'test')).rejects.toThrow(/individuais/);
  expect((await f.provider.send('258840000001@c.us', 'Test')).confirmation).toBe('confirmed');
  await f.provider.disconnect();
});
it('serves QR only via private ephemeral state and removes it after authentication', async () => {
  const f = fixture();
  const engine = new SalesEngine(f.root, undefined, f.provider);
  try {
    await engine.messaging.configure('web_experimental', true);
    await engine.messaging.connect(true);
    await Promise.resolve();
    f.emitter.emit('qr', 'TEST-ONLY-QR');
    expect(engine.messaging.snapshot().connection.qrAvailable).toBe(true);
    expect(JSON.stringify(engine.messaging.snapshot())).not.toContain('TEST-ONLY-QR');
    expect((await engine.messaging.qrImage()).image).toMatch(/^data:image\/png;base64,/);
    f.emitter.emit('ready');
    await expect(engine.messaging.qrImage()).rejects.toThrow(/indisponível/);
  } finally {
    engine.close();
  }
});
it('rejects experimental connection without explicit administrator confirmation', async () => {
  const f = fixture();
  const engine = new SalesEngine(f.root);
  try {
    await expect(engine.messaging.configure('web_experimental')).rejects.toThrow(/Confirmar/);
    await engine.messaging.configure('web_experimental', true);
    await expect(engine.messaging.connect()).rejects.toThrow(/Confirmar/);
  } finally {
    engine.close();
  }
});
it('keeps Cloud API transport unimplemented and incapable of sending or auto replies', async () => {
  const p = new WhatsAppCloudApiProvider();
  expect(p.capabilities.send).toBe(false);
  expect(p.capabilities.automatic).toBe(false);
  await expect(p.connect()).rejects.toThrow(/não implementada/);
  await expect(p.send()).rejects.toThrow(/sem capacidade/);
});
it('requires state outside a Git checkout before creating an experimental session', async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.root, '.git'));
  fs.writeFileSync(path.join(f.root, '.git', 'HEAD'), 'ref: refs/heads/test\n');
  const engine = new SalesEngine(f.root, undefined, f.provider);
  try {
    await engine.messaging.configure('web_experimental', true);
    await expect(engine.messaging.connect(true)).rejects.toThrow(/fora de qualquer checkout/);
    expect(f.initialize).not.toHaveBeenCalled();
  } finally {
    engine.close();
  }
});
it('does not delete or follow a symlink session', async () => {
  const f = fixture();
  const outside = path.join(f.root, 'retained');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'important'), 'preserve');
  fs.symlinkSync(outside, path.join(f.root, 'messaging-auth'));
  const engine = new SalesEngine(f.root);
  try {
    await engine.messaging.configure('web_experimental', true);
    await expect(engine.messaging.connect(true)).rejects.toThrow(/symlink/);
    await expect(engine.messaging.disconnect(true)).rejects.toThrow(/Falha/);
    expect(fs.readFileSync(path.join(outside, 'important'), 'utf8')).toBe('preserve');
  } finally {
    engine.close();
  }
});
it('updates CRM and assigns CEO atomically after a fake client confirms an invitation (not real WhatsApp)', async () => {
  const f = fixture();
  const engine = new SalesEngine(f.root, undefined, f.provider);
  try {
    await engine.messaging.configure('web_experimental', true);
    await engine.messaging.connect(true);
    await Promise.resolve();
    f.emitter.emit('ready');
    engine.messaging.suspend(false);
    f.emitter.emit('message', {
      fromMe: false,
      from: '258840000001@c.us',
      type: 'chat',
      body: 'TESTE: tenho interesse e aceito o link',
      id: { _serialized: 'inbound-fixture' },
    });
    const c = engine.messaging.store.list('web_experimental').items[0];
    const source = engine.crm.createSource({
      name: 'FICTÍCIO',
      kind: 'manual',
      url: null,
      termsUrl: null,
      permissionEvidence: 'Unit fixture',
      attribution: 'Teste',
      enabled: true,
      termsReviewed: true,
      commercialReuseAllowed: true,
    });
    const id = engine.crm.importCompanies(
      [
        {
          name: 'FICTÍCIO — ramo de dados do teste',
          contactChannel: 'whatsapp',
          businessContact: '258840000001',
        },
      ],
      source.id,
      'fixture',
      'provided',
    ).companyIds[0];
    engine.crm.consent(id, 'whatsapp', 'granted', 'Opt-in unit fixture', 'Teste');
    engine.messaging.link(c.id, id);
    engine.saveKnowledge({
      signupUrl: 'https://cadastro.example.org/',
      trialAvailable: true,
      trialDays: 7,
      confirmedFeatures: [],
      approvedPrices: [],
      policies: [],
    });
    const msg = engine.messaging.store.latestInbound(c.id);
    engine.messaging.acceptance(c.id, msg.id, 'interest', 'TESTE');
    engine.messaging.acceptance(c.id, msg.id, 'link_acceptance', 'TESTE');
    const d = engine.messaging.draft(
      c.id,
      'Teste 7 dias em https://cadastro.example.org/',
      'invitation',
    );
    engine.messaging.review(d.id, 'approved');
    await engine.messaging.send(d.id);
    expect(f.send).toHaveBeenCalledOnce();
    expect(engine.crm.company(id).stage).toBe('ceo');
    expect(engine.messaging.store.conversation(c.id).owner).toBe('ceo');
    expect(engine.crm.detail(id).handoffs).toHaveLength(1);
  } finally {
    engine.close();
  }
});
it('refuses to merge a different connected account into an existing inbox', async () => {
  const f = fixture();
  const engine = new SalesEngine(f.root, undefined, f.provider);
  try {
    await engine.messaging.configure('web_experimental', true);
    await engine.messaging.connect(true);
    await Promise.resolve();
    f.emitter.emit('ready');
    f.provider.emit('event', { type: 'state', status: 'connected', account: '258840000088' });
    expect(engine.messaging.snapshot().connection).toMatchObject({
      status: 'error',
      suspended: true,
    });
    f.emitter.emit('message', {
      fromMe: false,
      from: '258840000001@c.us',
      type: 'chat',
      body: 'Do not mix',
      id: { _serialized: 'wrong-account' },
    });
    expect(engine.messaging.store.list('web_experimental').total).toBe(0);
  } finally {
    engine.close();
  }
});
