/** All business records in this browser scenario are explicitly simulated fixtures. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { chromium } from 'playwright';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agexa-conversion-browser-'));
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
    name: 'CONVERSÕES FICTÍCIAS',
    kind: 'manual',
    url: null,
    termsUrl: null,
    permissionEvidence: 'Fixtures isolados para teste',
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
        name: 'Barbearia TESTE Conversão',
        sector: 'barbearia',
        city: 'Beira',
        country: 'Moçambique',
        contactChannel: 'whatsapp',
        businessContact: '258840000001',
      },
    ],
  });
  const imported = await until((s) => s.crm.totalCompanies === 1);
  const company = imported.crm.companies[0];
  await api(`crm/companies/${company.id}/consent`, {
    channel: 'whatsapp',
    status: 'granted',
    origin: 'Fixture',
    evidence: 'Opt-in fictício',
  });
  await api('knowledge', {
    signupUrl: 'https://cadastro.example.org/',
    trialAvailable: true,
    trialDays: 7,
    confirmedFeatures: ['Gestão de marcações TESTE'],
    approvedPrices: [],
    policies: [],
  });
  await api('messaging/test/inbound', {
    id: 'conversion-inbound',
    remoteId: '258840000001@c.us',
    body: 'TESTE: tenho interesse e aceito receber o link para experimentar.',
  });
  const conversation = (await api('messaging/conversations')).items[0];
  await api(`messaging/conversations/${conversation.id}/company`, { companyId: company.id });
  const incoming = (await api(`messaging/conversations/${conversation.id}`)).messages[0];
  for (const kind of ['interest', 'link_acceptance'])
    await api(`messaging/conversations/${conversation.id}/acceptance`, {
      messageId: incoming.id,
      kind,
      evidence: 'Declaração fictícia de teste',
      confirmed: true,
    });
  const draft = await api(`messaging/conversations/${conversation.id}/drafts`, {
    body: 'Sou o assistente virtual do Agexa. Teste 7 dias: https://cadastro.example.org/',
    kind: 'invitation',
  });
  await api(`messaging/drafts/${draft.id}/review`, { decision: 'approved' });
  await api(`messaging/drafts/${draft.id}/send`, { confirmed: true });
  const before = await api('state');
  assert.equal(before.conversion.accounts.length, 0);
  assert.equal(before.conversion.followups.length, 1);
  const followup = before.conversion.followups[0];
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
    await page.getByRole('button', { name: 'Conversões', exact: true }).click();
  }
  await login();
  await page
    .getByRole('heading', { name: 'AGEXA SALES CONVERSION DASHBOARD', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Atendimento CEO', exact: true }).click();
  await page.getByRole('button', { name: 'Consultar transferência', exact: true }).click();
  await page
    .getByRole('heading', { name: 'NOVO CLIENTE INTERESSADO — ATENDIMENTO DO CEO', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Confirmar cadastro ou pagamento', exact: true }).click();
  await page
    .getByLabel('ID opaco da conta no sistema', { exact: true })
    .fill('fixture-account-browser');
  await page
    .getByLabel('Evidência independente', { exact: true })
    .fill('TESTE: cadastro verificado em cenário fictício.');
  await page
    .getByLabel('Data efetiva do evento', { exact: true })
    .fill(new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 16));
  await page
    .getByText(
      'Confirmei este facto e a associação à empresa; o registo será identificado como manual.',
      { exact: true },
    )
    .click();
  await page.getByRole('button', { name: 'Registar facto confirmado', exact: true }).click();
  await until((s) => s.conversion.accounts.length === 1);
  await page.getByLabel('Facto confirmado', { exact: true }).selectOption('trial_started');
  const trialStartValue = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 16),
    end = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 16);
  await page.getByLabel('Início efetivo do teste', { exact: true }).fill(trialStartValue);
  await page.getByLabel('Data efetiva do evento', { exact: true }).fill(trialStartValue);
  await page.getByLabel('Término informado pelo sistema', { exact: true }).fill(end);
  await page
    .getByLabel('Evidência independente', { exact: true })
    .fill('TESTE: datas efetivas sete dias.');
  await page
    .getByText(
      'Confirmei este facto e a associação à empresa; o registo será identificado como manual.',
      { exact: true },
    )
    .click();
  await page.getByRole('button', { name: 'Registar facto confirmado', exact: true }).click();
  await until((s) => s.conversion.trials.length === 1);
  await page.getByRole('button', { name: 'Free Trial Tracker', exact: true }).click();
  await page.getByRole('heading', { name: 'FREE TRIAL TRACKER', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Registar teste ou pagamento', exact: true }).click();
  await page.getByLabel('Facto confirmado', { exact: true }).selectOption('payment_confirmed');
  await page
    .getByLabel('ID opaco da conta no sistema', { exact: true })
    .fill('fixture-account-browser');
  await page.getByLabel('ID do recibo confirmado', { exact: true }).fill('fixture-receipt-browser');
  await page.getByLabel('Montante em unidades mínimas da moeda', { exact: true }).fill('150000');
  await page
    .getByLabel('Evidência independente', { exact: true })
    .fill('TESTE: recibo fictício, sem pagamento real.');
  await page
    .getByText(
      'Confirmei este facto e a associação à empresa; o registo será identificado como manual.',
      { exact: true },
    )
    .click();
  await page.getByRole('button', { name: 'Registar facto confirmado', exact: true }).click();
  await until((s) => s.conversion.metrics.origins.simulated.paying === 1);
  const after = await api('state');
  assert.equal(after.conversion.metrics.origins.manual.paying, 0);
  assert.equal(after.conversion.metrics.origins.integration.paying, 0);
  assert.equal(after.conversion.metrics.origins.simulated.revenue.MZN, 150000);
  assert.equal(after.conversion.trials[0].status, 'converted');
  assert.equal((await api(`messaging/conversations/${conversation.id}`)).messages.length, 2);
  assert.equal((await api(`messaging/conversations/${conversation.id}`)).conversation.owner, 'ceo');
  // Additional explicitly simulated trial fixtures for meaningful tracker screenshots.
  await api('crm/import', {
    sourceId: source.id,
    authorized: true,
    businessOnly: true,
    simulated: true,
    records: [
      { name: 'Clínica TESTE Ativa', sector: 'clínica', city: 'Maputo' },
      { name: 'Oficina TESTE Expirada', sector: 'oficina', city: 'Beira' },
    ],
  });
  await until((s) => s.crm.totalCompanies === 3);
  const state = await api('state');
  for (const [i, name] of ['Clínica TESTE Ativa', 'Oficina TESTE Expirada'].entries()) {
    const co = state.crm.companies.find((c) => c.name === name);
    const accountId = 'fixture-extra-' + i;
    async function record(kind, extra = {}) {
      return api('conversion/manual', {
        companyId: co.id,
        confirmed: true,
        fact: {
          eventId: crypto.randomUUID(),
          appId: 'manual-agexa',
          accountId,
          kind,
          occurredAt: new Date(Date.now() - 1000).toISOString(),
          evidence: 'FIXTURE SIMULADO',
          ...extra,
        },
      });
    }
    await record('account_created', {
      occurredAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    });
    await record('trial_started', {
      occurredAt: new Date(Date.now() - (i ? 8 : 6) * 86400000).toISOString(),
      startAt: new Date(Date.now() - (i ? 8 : 6) * 86400000).toISOString(),
      endAt: new Date(Date.now() + (i ? -1 : 1) * 86400000).toISOString(),
    });
    if (i) await record('trial_ended');
  }
  await page.getByRole('button', { name: 'Validação técnica', exact: true }).click();
  await page
    .getByRole('button', { name: 'Executar verificação de inferência', exact: true })
    .click();
  await until((s) => s.conversion.validations.some((v) => v.mode === 'unavailable'));
  await page.getByRole('button', { name: 'Free Trial Tracker', exact: true }).click();
  await page.getByRole('button', { name: 'Atualizar alertas internos', exact: true }).click();
  const persisted = await api('state');
  const noticeIds = persisted.conversion.notices.map((n) => n.id);
  const inviteId = persisted.conversion.invites[0].id;
  await page.goto('about:blank');
  await stop();
  await start();
  const restored = await api('state');
  assert.equal(restored.conversion.accounts.length, 3);
  assert.equal(restored.conversion.trials.length, 3);
  assert.equal(restored.conversion.invites[0].id, inviteId);
  assert.equal(restored.conversion.followups[0].id, followup.id);
  assert.deepEqual(
    restored.conversion.notices.map((n) => n.id),
    noticeIds,
  );
  assert.equal((await api(`messaging/conversations/${conversation.id}`)).conversation.owner, 'ceo');
  await login();
  await page
    .getByRole('heading', { name: 'AGEXA SALES CONVERSION DASHBOARD', exact: true })
    .waitFor();
  if (process.env.AGEXA_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.AGEXA_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.AGEXA_SCREENSHOT_DIR, 'phase6-dashboard-test-desktop.png'),
    });
  }
  await page.getByRole('button', { name: 'Free Trial Tracker', exact: true }).click();
  await page
    .getByRole('heading', { name: 'FREE TRIAL TRACKER', exact: true })
    .scrollIntoViewIfNeeded();
  if (process.env.AGEXA_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(process.env.AGEXA_SCREENSHOT_DIR, 'phase6-tracker-test-desktop.png'),
    });
  const bounds = await page
    .getByRole('complementary', { name: 'Painel privado do CEO' })
    .boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1551);
  await page.getByRole('button', { name: 'Recolher painel', exact: true }).click();
  await page.waitForTimeout(200);
  if (process.env.AGEXA_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(process.env.AGEXA_SCREENSHOT_DIR, 'phase6-office-test-desktop.png'),
    });
  await page.getByRole('button', { name: 'Painel CEO', exact: true }).click();
  await page.getByRole('button', { name: 'Conversões', exact: true }).click();
  await page.getByRole('button', { name: 'Free Trial Tracker', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('columnheader', { name: 'Dias restantes', exact: true })
    .scrollIntoViewIfNeeded();
  await page.locator('.crm-scroll').evaluateAll((nodes) =>
    nodes.forEach((node) => {
      node.scrollLeft = 0;
    }),
  );
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  if (process.env.AGEXA_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(process.env.AGEXA_SCREENSHOT_DIR, 'phase6-tracker-test-mobile.png'),
    });
  assert.deepEqual(errors, []);
  console.log(
    'PASS — FICTIONAL CONVERSIONS ONLY: real backend/SQLite, mock handoff, audited manual facts, exact dates, simulated receipt, independent unavailable-IA check, persistent notices/restart, protected human control and desktop/mobile. No real Base44, inference or WhatsApp authentication.',
  );
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page && process.env.AGEXA_SCREENSHOT_DIR)
    await page
      .screenshot({ path: path.join(process.env.AGEXA_SCREENSHOT_DIR, 'phase6-test-failure.png') })
      .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await stop();
  fs.rmSync(root, { recursive: true, force: true });
}
