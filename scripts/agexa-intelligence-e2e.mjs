/** Contract tests only: no local LLM or real inference is used by this script. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { chromium } from 'playwright';

import { mockOllama } from '../server/__tests__/helpers/mockOllama.ts';

const mock = await mockOllama();
mock.control.delayMs = 300;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agexa-intel-browser-'));
const probe = net.createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
let child;
let browser;
let token;
async function start() {
  child = spawn(
    process.execPath,
    ['dist/cli.js', '--agexa', '--host', '127.0.0.1', '--port', String(port), '--no-terminal'],
    {
      env: { ...process.env, AGEXA_DATA_DIR: root, AGEXA_INFERENCE_TEST_MODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('Test server failed to start')), 20000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/\/\?token=([A-Za-z0-9-]+)/);
      if (match) {
        token = match[1];
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.resume();
    child.once('exit', () => {
      clearTimeout(timer);
      reject(Error('Test server exited'));
    });
  });
}
async function stop() {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
}
async function state() {
  const response = await fetch(`${base}/api/agexa/state`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function until(predicate) {
  const end = Date.now() + 20000;
  while (true) {
    const value = await state();
    if (predicate(value)) return value;
    if (Date.now() > end) throw Error('Intelligence browser state timeout');
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__PIXEL_AGENTS_E2E = true;
    window.__observedCommercialActivity = [];
    setInterval(() => {
      for (const ch of window.__pixelAgentsTestHooks?.getCharacters?.() ?? []) {
        if (
          ch.isActive &&
          ch.commercialStatus &&
          !window.__observedCommercialActivity.includes(ch.agentName)
        )
          window.__observedCommercialActivity.push(ch.agentName);
      }
    }, 20);
  });
  await page.goto(base);
  await page.getByLabel('Token administrativo').fill(token);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: 'Central IA', exact: true }).click();
  await page.getByLabel('Endereço Ollama', { exact: true }).fill(mock.url);
  await page.getByRole('button', { name: 'Guardar configuração de IA', exact: true }).click();
  await until((s) => s.intelligence.status.models.includes('agexa-test:tiny'));
  await page.getByLabel('Modelo instalado', { exact: true }).selectOption('agexa-test:tiny');
  await page.getByRole('button', { name: 'Guardar configuração de IA', exact: true }).click();
  await until((s) => s.intelligence.status.connected);
  await page.getByRole('button', { name: 'Nexus', exact: true }).click();
  await page
    .getByLabel('Ordem comercial ao Nexus', { exact: true })
    .fill('SIMULAÇÃO: estratégia autorizada para barbearias da Beira');
  await page.getByText('Confirmo a autorização destes dados.', { exact: true }).click();
  await page.getByRole('button', { name: 'Pedir plano ao Nexus', exact: true }).click();
  await until((s) => s.employees.some((e) => e.id === 'nexus' && e.status === 'working'));
  await page.waitForFunction(() => window.__observedCommercialActivity.includes('NEXUS'));
  const proposed = await until((s) => s.intelligence.workflows[0]?.status === 'proposed');
  assert.equal(proposed.tasks.length, 1);
  assert.equal(mock.calls.length, 1);
  await page.getByRole('button', { name: 'Aprovar plano e iniciar equipa', exact: true }).click();
  const completed = await until((s) => s.intelligence.workflows[0]?.status === 'completed');
  assert.equal(completed.tasks.length, 9);
  assert.deepEqual(
    mock.calls.map((c) => c.employeeId),
    ['nexus', 'hunter', 'atlas', 'maya', 'luna', 'victor', 'sophia', 'orion', 'nexus'],
  );
  assert.ok(
    completed.tasks.every(
      (t) =>
        t.status === 'completed' &&
        t.result?.executionMode === 'test' &&
        t.model === 'agexa-test:tiny' &&
        typeof t.durationMs === 'number',
    ),
  );
  const animated = await page.evaluate(() => window.__observedCommercialActivity);
  assert.equal(
    new Set(animated).size,
    8,
    'Every employee must actually animate during its own HTTP inference',
  );
  await page.waitForFunction(() =>
    window.__pixelAgentsTestHooks
      .getCharacters()
      .filter((ch) => ch.commercialStatus)
      .every((ch) => !ch.isActive),
  );
  assert.equal(completed.intelligence.memories.filter((m) => m.kind === 'summary').length, 9);
  assert.ok(!JSON.stringify(completed).includes('internal reasoning'));
  await stop();
  await start();
  const restored = await until((s) => s.intelligence.status.connected);
  assert.equal(restored.intelligence.workflows[0].status, 'completed');
  assert.equal(restored.tasks.length, 9);
  await page.reload();
  await page.getByRole('button', { name: 'Nexus', exact: true }).click();
  await page
    .getByRole('heading', { name: 'SIMULAÇÃO: estratégia autorizada para barbearias da Beira', exact: true })
    .waitFor();
  await page.getByText('TESTE · API Ollama simulada', { exact: true }).waitFor();
  if (process.env.AGEXA_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.AGEXA_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.AGEXA_SCREENSHOT_DIR, 'phase3-simulated-desktop.png'),
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log(
    'PASS — SIMULATED OLLAMA ONLY: model selection, approved Nexus plan, nine separate requests, eight backend-driven animated employees, persistence/reconnect and desktop/mobile',
  );
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page && process.env.AGEXA_SCREENSHOT_DIR)
    await page
      .screenshot({ path: path.join(process.env.AGEXA_SCREENSHOT_DIR, 'phase3-test-failure.png') })
      .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await stop();
  await mock.close();
  fs.rmSync(root, { recursive: true, force: true });
}
