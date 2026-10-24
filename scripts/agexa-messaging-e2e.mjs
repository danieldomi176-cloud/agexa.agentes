/** All business records in this browser scenario are explicitly simulated fixtures. */
import assert from 'node:assert/strict';
import { confirmFixtureOffer } from './helpers/offer-fixture.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { chromium } from 'playwright';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agexa-messaging-browser-'));
const probe = net.createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
let server;
let browser;
let token;
async function start() {
  server = spawn(
    process.execPath,
    ['dist/cli.js', '--agexa', '--host', '127.0.0.1', '--port', String(port), '--no-terminal'],
    {
      env: {
        ...process.env,
        AGEXA_DATA_DIR: root,
        AGEXA_MESSAGING_TEST_MODE: '1',
        AGEXA_INFERENCE_TEST_MODE: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('Messaging test server startup failed')), 20000);
    server.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/\/\?token=([A-Za-z0-9-]+)/);
      if (match) {
        token = match[1];
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.resume();
    server.once('exit', () => {
      clearTimeout(timer);
      reject(Error('Messaging test server exited'));
    });
  });
}
async function stop() {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit');
  }
}
async function api(route, body) {
  const response = await fetch(`${base}/api/agexa/${route}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert.ok(response.ok, `Messaging API ${route}: ${response.status} ${result.error ?? ''}`);
  return result;
}
async function until(predicate) {
  const end = Date.now() + 20000;
  while (true) {
    const s = await api('state');
    if (predicate(s)) return s;
    if (Date.now() > end) throw Error('Messaging state timeout');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
try {
  await start();
  await api('messaging/config', { provider: 'mock', confirmedExperimental: false });
  await api('messaging/connection', { action: 'connect', confirmedExperimental: false });
  await api('messaging/suspension', { suspended: false });
  const source = await api('crm/sources', {
    name: 'EMPRESAS FICTÍCIAS TESTE',
    kind: 'manual',
    url: null,
    termsUrl: null,
    permissionEvidence: 'Fixtures empresariais autorizados apenas para testes',
    attribution: 'TESTE',
    enabled: true,
    termsReviewed: true,
    commercialReuseAllowed: true,
  });
  await api('crm/import', {
    sourceId: source.id,
    authorized: true,
    businessOnly: true,
    simulated: true,
    records: [
      {
        name: 'Barbearia TESTE WhatsApp',
        city: 'Beira',
        country: 'Moçambique',
        sector: 'barbearia',
        contactChannel: 'whatsapp',
        businessContact: '+258840000001',
      },
    ],
  });
  const imported = await until((s) => s.crm.totalCompanies === 1);
  const company = imported.crm.companies[0];
  await api(`crm/companies/${company.id}/consent`, {
    channel: 'whatsapp',
    status: 'granted',
    origin: 'Fixture de opt-in',
    evidence: 'Consentimento fictício exclusivo de testes',
  });
  await confirmFixtureOffer(api, {
    signupUrl: 'https://cadastro.example.org/',
    trialAvailable: true,
    trialDays: 7,
    confirmedFeatures: ['Gestão de marcações TESTE'],
    approvedPrices: [],
    policies: [],
  });
  await api('messaging/test/inbound', {
    id: 'fixture-inbound-1',
    remoteId: '258840000001@c.us',
    body: 'Olá! Preciso organizar as marcações do meu negócio.',
  });
  const inbox = await api('messaging/conversations');
  const conversation = inbox.items[0];
  browser = await chromium.launch(
    process.env.AGEXA_CHROMIUM_PATH
      ? { executablePath: process.env.AGEXA_CHROMIUM_PATH, args: ['--no-sandbox'] }
      : {},
  );
  const page = await browser.newPage({ viewport: { width: 1550, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__PIXEL_AGENTS_E2E = true;
  });
  async function login() {
    await page.goto(base);
    await page.getByLabel('Token administrativo').fill(token);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByRole('button', { name: 'WhatsApp Center', exact: true }).click();
  }
  await login();
  await page.getByRole('heading', { name: 'AGEXA WHATSAPP SALES CENTER', exact: true }).waitFor();
  await page.getByRole('button', { name: /Cliente TESTE/ }).click();
  await page.getByLabel('Empresa CRM', { exact: true }).selectOption(company.id);
  await page.getByRole('button', { name: 'Associar empresa explicitamente', exact: true }).click();
  await until((s) => s.messaging.notifications.some((e) => e.action === 'company_linked'));
  await page.getByText('Trabalho dos funcionários', { exact: true }).click();
  await page.getByRole('button', { name: 'Preparar material interno', exact: true }).click();
  await until((s) =>
    s.tasks.some(
      (t) => t.employeeId === 'luna' && t.kind === 'messaging_work' && t.status === 'completed',
    ),
  );
  await page.getByRole('button', { name: 'Aprovar versão 1', exact: true }).click();
  await page.getByText('Confirmo o envio individual desta versão exata.', { exact: true }).click();
  await page.getByRole('button', { name: 'Enviar versão 1', exact: true }).click();
  await until((s) => s.messaging.metrics.confirmedSimulatedSends === 1);
  await page
    .getByLabel('Texto da resposta', { exact: true })
    .fill('Rascunho manual TESTE para rejeitar.');
  await page.getByRole('button', { name: 'Guardar rascunho manual', exact: true }).click();
  await page.getByRole('button', { name: 'Rejeitar versão 2', exact: true }).click();
  await api('messaging/test/inbound', {
    id: 'fixture-inbound-2',
    remoteId: '258840000001@c.us',
    body: 'Sim, tenho interesse e aceito receber o link para experimentar.',
  });
  const d = await api(`messaging/conversations/${conversation.id}`);
  const inbound = d.messages.find((m) => m.providerId === 'fixture-inbound-2');
  await page.getByText('Interesse e aceitação do link', { exact: true }).click();
  await page
    .getByLabel('Mensagem que comprova a declaração', { exact: true })
    .selectOption(inbound.id);
  await page
    .getByLabel('Evidência da declaração', { exact: true })
    .fill('Cliente TESTE aceitou expressamente na mensagem selecionada.');
  await page
    .getByText('Confirmei a declaração do cliente nesta mensagem.', { exact: true })
    .click();
  await page.getByRole('button', { name: 'Registar interesse', exact: true }).click();
  await until((s) => s.messaging.notifications.some((e) => e.action === 'interest'));
  await page.getByRole('button', { name: 'Registar aceitação do link', exact: true }).click();
  await until((s) => s.messaging.notifications.some((e) => e.action === 'link_acceptance'));
  await page.getByLabel('Funcionário na conversa', { exact: true }).selectOption('sophia');
  await page.getByRole('button', { name: 'Preparar material interno', exact: true }).click();
  await page.getByRole('button', { name: 'Aprovar versão 3', exact: true }).click();
  await page.getByText('Confirmo o envio individual desta versão exata.', { exact: true }).click();
  await page.getByRole('button', { name: 'Enviar versão 3', exact: true }).click();
  await until((s) => s.messaging.metrics.confirmedSimulatedSends === 2);
  const handed = await api(`messaging/conversations/${conversation.id}`);
  assert.equal(handed.conversation.owner, 'ceo');
  assert.equal(handed.conversation.state, 'human');
  assert.equal(handed.messages.length, 4);
  assert.equal((await api('state')).messaging.metrics.confirmedRealSends, 0);
  await page.getByRole('button', { name: 'PARAR TODA A AUTOMAÇÃO', exact: true }).click();
  await until((s) => s.suspended && s.messaging.connection.suspended);
  await page.goto('about:blank');
  await stop();
  await start();
  const restored = await api(`messaging/conversations/${conversation.id}`);
  assert.equal(restored.messages.length, 4);
  assert.equal(restored.conversation.id, conversation.id);
  assert.equal(restored.conversation.owner, 'ceo');
  assert.equal((await api('state')).messaging.connection.status, 'disconnected');
  await api('operations', { suspended: false });
  await api('messaging/suspension', { suspended: false });
  await api('messaging/connection', { action: 'connect', confirmedExperimental: false });
  await login();
  await page.getByRole('button', { name: /Cliente TESTE/ }).click();
  await page
    .getByRole('heading', { name: 'Histórico de mensagens', exact: true })
    .scrollIntoViewIfNeeded();
  if (process.env.AGEXA_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.AGEXA_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.AGEXA_SCREENSHOT_DIR, 'phase5-inbox-test-desktop.png'),
    });
  }
  const bounds = await page
    .getByRole('complementary', { name: 'Painel privado do CEO' })
    .boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1551);
  await page.getByRole('button', { name: 'Recolher painel', exact: true }).click();
  await page.waitForTimeout(200);
  if (process.env.AGEXA_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(process.env.AGEXA_SCREENSHOT_DIR, 'phase5-office-test-desktop.png'),
    });
  await page.getByRole('button', { name: 'Painel CEO', exact: true }).click();
  await page.getByRole('button', { name: 'WhatsApp Center', exact: true }).click();
  await page.getByRole('button', { name: /Cliente TESTE/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('heading', { name: 'Histórico de mensagens', exact: true })
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  if (process.env.AGEXA_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(process.env.AGEXA_SCREENSHOT_DIR, 'phase5-inbox-test-mobile.png'),
    });
  assert.deepEqual(errors, []);
  console.log(
    'PASS — SIMULATED WHATSAPP ONLY, NO AI: private inbox, CRM link, Luna rules, exact human approval, mock sending, rejected draft, Sophia invitation, CEO handoff, stop, persistence/restart and desktop/mobile. No real account authenticated.',
  );
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page && process.env.AGEXA_SCREENSHOT_DIR)
    await page
      .screenshot({ path: path.join(process.env.AGEXA_SCREENSHOT_DIR, 'phase5-test-failure.png') })
      .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await stop();
  fs.rmSync(root, { recursive: true, force: true });
}
