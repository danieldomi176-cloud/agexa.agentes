/** All business records in this browser scenario are explicitly simulated fixtures. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { chromium } from 'playwright';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agexa-crm-browser-'));
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
    { env: { ...process.env, AGEXA_DATA_DIR: root }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('CRM test server startup failed')), 20000);
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
      reject(Error('CRM test server exited'));
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
  assert.ok(response.ok, `CRM API ${route}: ${response.status} ${result.error ?? ''}`);
  return result;
}
async function until(predicate) {
  const end = Date.now() + 20000;
  while (true) {
    const s = await api('state');
    if (predicate(s)) return s;
    if (Date.now() > end) throw Error('CRM state timeout');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
try {
  await start();
  browser = await chromium.launch({
    ...(process.env.AGEXA_CHROMIUM_PATH
      ? { executablePath: process.env.AGEXA_CHROMIUM_PATH, args: ['--no-sandbox'] }
      : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1550, height: 1050 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__PIXEL_AGENTS_E2E = true;
  });
  await page.goto(base);
  await page.getByLabel('Token administrativo').fill(token);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: 'Prospeção', exact: true }).click();
  await page.getByText('Adicionar fonte autorizada', { exact: true }).click();
  await page.getByLabel('Nome da fonte', { exact: true }).fill('CSV TESTE — empresas fictícias');
  await page
    .getByLabel('Origem e evidência de autorização', { exact: true })
    .fill('Fixture de teste, dados empresariais fictícios autorizados');
  await page
    .getByLabel('Atribuição exigida pela fonte', { exact: true })
    .fill('Dados fictícios de teste');
  await page
    .getByText('Verifiquei os termos e a permissão de reutilização comercial.', { exact: true })
    .click();
  await page.getByRole('button', { name: 'Guardar fonte', exact: true }).click();
  const created = await until((s) => s.crm.sources.length === 1);
  const source = created.crm.sources[0];
  await page.getByLabel('Fonte disponível', { exact: true }).selectOption(source.id);
  const csv =
    'name,sector,city,country,contactChannel,businessContact,usesAppointments,organizationNeed,hasSchedulingSystem,sufficientInfo\nBarbearia TESTE A,barbearia,Beira,Moçambique,email,empresa-a@example.org,true,true,false,true\nSalão TESTE B,salão,Maputo,Moçambique,none,,true,,,\nBarbearia TESTE A,barbearia,Beira,Moçambique,email,empresa-a@example.org,true,true,false,true';
  await page
    .getByLabel('Ficheiro CSV', { exact: true })
    .setInputFiles({ name: 'empresas-teste.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByText('Autorizo a importação/análise desta fonte.', { exact: true }).click();
  await page
    .getByText(
      'São apenas dados empresariais autorizados, sem recolha indiscriminada de pessoas.',
      { exact: true },
    )
    .click();
  await page
    .getByText('Estes registos são simulação e devem ficar separados das métricas reais.', {
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Executar Hunter', exact: true }).click();
  const imported = await until((s) => s.crm.batches[0]?.status === 'completed');
  assert.equal(imported.crm.totalCompanies, 2);
  assert.equal(imported.crm.batches[0].result.duplicates, 1);
  const company = imported.crm.companies.find((c) => c.name === 'Barbearia TESTE A');
  assert.equal(company.recordMode, 'simulated');
  await api('knowledge', {
    signupUrl: 'https://cadastro.example.org/',
    trialAvailable: true,
    trialDays: 7,
    confirmedFeatures: ['Gestão de marcações confirmada para teste'],
    approvedPrices: [],
    policies: [],
  });
  await page.getByRole('button', { name: 'CRM', exact: true }).click();
  await page.getByRole('button', { name: 'Barbearia TESTE A', exact: true }).click();
  await page.getByRole('button', { name: 'Qualificar com Atlas', exact: true }).click();
  await until((s) => s.crm.companies.find((c) => c.id === company.id)?.score === 100);
  await page.getByRole('button', { name: 'Preparar abordagem Maya', exact: true }).click();
  await until((s) => s.crm.drafts.some((d) => d.companyId === company.id && d.kind === 'approach'));
  await page.getByText('Consentimento por canal', { exact: true }).click();
  await page
    .getByLabel('Origem do consentimento', { exact: true })
    .fill('Opt-in fictício do teste');
  await page
    .getByLabel('Evidência do consentimento', { exact: true })
    .fill('Fixture: autorização comercial explícita para email empresarial');
  await page.getByRole('button', { name: 'Registar consentimento', exact: true }).click();
  await until((s) => s.crm.companies.find((c) => c.id === company.id)?.eligibility.allowed);
  await page.getByRole('button', { name: 'Aprovar versão 1', exact: true }).click();
  await until((s) => s.crm.drafts.some((d) => d.status === 'approved'));
  await page.getByLabel('Nova etapa', { exact: true }).selectOption('prepared');
  await page.getByRole('button', { name: 'Guardar etapa', exact: true }).click();
  await until((s) => s.crm.companies.find((c) => c.id === company.id)?.stage === 'prepared');
  await page.getByLabel('Nova etapa', { exact: true }).selectOption('paying');
  await page.getByRole('button', { name: 'Guardar etapa', exact: true }).click();
  await page.getByRole('alert').first().waitFor();
  assert.equal(
    (await api('state')).crm.companies.find((c) => c.id === company.id).stage,
    'prepared',
  );
  await page.getByRole('button', { name: 'Sales Workspace', exact: true }).click();
  await page
    .getByLabel('Objetivo comercial Nexus', { exact: true })
    .fill('TESTE: encontrar oportunidades na Beira e preparar materiais internos');
  await page.getByLabel('Fonte de pesquisa autorizada', { exact: true }).selectOption(source.id);
  await page.getByRole('button', { name: 'Propor operação comercial', exact: true }).click();
  const proposed = await until(
    (s) =>
      s.crm.orders.length === 1 &&
      s.tasks.some((t) => t.id === s.crm.orders[0].planTaskId && t.status === 'completed'),
  );
  const order = proposed.crm.orders[0];
  await page.getByRole('button', { name: 'Aprovar operação comercial', exact: true }).click();
  await until((s) => s.crm.orders[0]?.status === 'completed');
  const done = await api('state');
  assert.equal(done.crm.analytics.sentMessages, null);
  assert.equal(done.crm.analytics.confirmedPaying, null);
  assert.equal(done.crm.analytics.companies, 0);
  assert.equal(done.crm.analytics.simulatedCompanies, 2);
  assert.ok(
    done.tasks.some(
      (t) => t.employeeId === 'orion' && t.kind === 'crm_report' && t.status === 'completed',
    ),
  );
  await page.goto('about:blank');
  await stop();
  await start();
  await page.goto(base);
  await page.getByLabel('Token administrativo').fill(token);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  if (process.env.AGEXA_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.AGEXA_SCREENSHOT_DIR, { recursive: true });
    await page.getByRole('button', { name: 'Recolher painel', exact: true }).click();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(process.env.AGEXA_SCREENSHOT_DIR, 'phase4-office-test-desktop.png'),
    });
    await page.getByRole('button', { name: 'Painel CEO', exact: true }).click();
  }
  await page.getByRole('button', { name: 'CRM', exact: true }).click();
  await page.getByRole('button', { name: 'Barbearia TESTE A', exact: true }).waitFor();
  const restored = await api('state');
  assert.equal(restored.crm.totalCompanies, 2);
  assert.equal(restored.crm.orders[0].id, order.id);
  assert.equal(restored.crm.orders[0].status, 'completed');
  if (process.env.AGEXA_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(process.env.AGEXA_SCREENSHOT_DIR, 'phase4-crm-table-test-desktop.png'),
    });
  await page.getByRole('button', { name: 'Ver Kanban', exact: true }).click();
  await page
    .getByRole('button', { name: /Barbearia TESTE A/ })
    .first()
    .waitFor();
  const panelBounds = await page
    .getByRole('complementary', { name: 'Painel privado do CEO' })
    .boundingBox();
  assert.ok(
    panelBounds && panelBounds.x >= 0 && panelBounds.x + panelBounds.width <= 1551,
    'Desktop panel fits viewport',
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByText('Backend ligado', { exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  if (process.env.AGEXA_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.AGEXA_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.AGEXA_SCREENSHOT_DIR, 'phase4-crm-test-desktop.png'),
    });
  }
  await page.getByRole('button', { name: 'Relatórios', exact: true }).click();
  await page.getByRole('heading', { name: 'Sales Analytics', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  if (process.env.AGEXA_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(process.env.AGEXA_SCREENSHOT_DIR, 'phase4-crm-test-mobile.png'),
    });
  assert.deepEqual(errors, []);
  console.log(
    'PASS — SIMULATED BUSINESS FIXTURES, NO AI: authorized CSV, dedupe, CRM, separate consent, qualification, drafts, protected pipeline, Nexus coordination, reports, restart and desktop/mobile',
  );
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page && process.env.AGEXA_SCREENSHOT_DIR)
    await page
      .screenshot({
        path: path.join(process.env.AGEXA_SCREENSHOT_DIR, 'phase4-crm-test-failure.png'),
      })
      .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await stop();
  fs.rmSync(root, { recursive: true, force: true });
}
