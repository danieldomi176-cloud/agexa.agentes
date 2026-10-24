import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { chromium } from 'playwright';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agexa-browser-'));
const portProbe = net.createServer();
portProbe.listen(0, '127.0.0.1');
await once(portProbe, 'listening');
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const base = `http://127.0.0.1:${port}`;
let server;
let browser;
let token;
async function start() {
  server = spawn(
    process.execPath,
    ['dist/cli.js', '--agexa', '--host', '127.0.0.1', '--port', String(port), '--no-terminal'],
    {
      cwd: process.cwd(),
      env: { ...process.env, AGEXA_DATA_DIR: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Isolated server startup timed out')), 20000);
    let output = '';
    server.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/\/\?token=([A-Za-z0-9-]+)/);
      if (match) {
        token = match[1];
        clearTimeout(timer);
        resolve();
      }
    });
    // Do not print secret-bearing startup output.
    server.stderr.resume();
    server.once('exit', () => {
      clearTimeout(timer);
      reject(Error('Isolated server stopped unexpectedly'));
    });
  });
}
async function stop() {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit');
  }
}
const api = async (route, body) => {
  const response = await fetch(`${base}/api/agexa/${route}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `API failed on ${route}: ${response.status}`);
  return response.json();
};
try {
  await start();
  browser = await chromium.launch({
    ...(process.env.AGEXA_CHROMIUM_PATH ? { executablePath: process.env.AGEXA_CHROMIUM_PATH } : {}),
    args: process.env.AGEXA_CHROMIUM_PATH ? ['--no-sandbox'] : [],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__PIXEL_AGENTS_E2E = true;
  });
  await page.goto(base);
  await page.getByText('Área privada do CEO', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Suspender todas as operações' }).count(), 0);
  await page.getByLabel('Token administrativo').fill(token);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: 'Iniciar NEXUS', exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      window.__pixelAgentsTestHooks?.getAgentSeats?.().filter((e) => e.id <= -100 && e.id >= -107)
        .length === 8,
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid="agent-overlay"][data-agent-id^="-10"]').length === 8,
  );
  const seats = await page.evaluate(() =>
    window.__pixelAgentsTestHooks.getAgentSeats().filter((e) => e.id <= -100 && e.id >= -107),
  );
  assert.equal(new Set(seats.map((s) => s.seatId)).size, 8);
  assert.ok(
    seats.every((s) => s.seatId?.startsWith('agexa-')),
    'Every employee must occupy its own real chair',
  );
  assert.equal(new Set(seats.map((s) => s.areaLabel)).size, 5);
  await page
    .getByLabel('Objetivo', { exact: true })
    .fill('E2E: organizar oportunidades autorizadas');
  await page.getByText('Confirmo que estes dados são autorizados.', { exact: true }).click();
  await page.getByRole('button', { name: 'Atribuir tarefa', exact: true }).click();
  await page.getByRole('button', { name: 'Iniciar NEXUS', exact: true }).click();
  await page.getByText('Resultado estruturado', { exact: true }).waitFor();
  const before = await api('state');
  const task = before.tasks.find((t) => t.objective === 'E2E: organizar oportunidades autorizadas');
  assert.equal(task.status, 'completed');
  assert.equal(task.result.inference, false);
  await page.getByRole('button', { name: 'Suspender todas as operações', exact: true }).click();
  await page.getByRole('button', { name: 'Retomar operações', exact: true }).waitFor();
  assert.equal((await api('state')).suspended, true);
  // A process restart tests actual SQLite and token persistence, and browser reconnection.
  await stop();
  await start();
  await page.waitForFunction(() =>
    document.querySelector('.agexa-header-actions')?.textContent?.includes('Backend ligado'),
  );
  const restored = await api('state');
  assert.equal(restored.suspended, true);
  assert.equal(restored.tasks.find((t) => t.id === task.id).status, 'completed');
  await page.reload();
  await page.getByRole('button', { name: 'Retomar operações', exact: true }).waitFor();
  // Original editor remains reachable and functional in the authenticated office.
  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  await page.getByRole('button', { name: 'Areas', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(root, 'desktop.png') });
  await page.getByRole('button', { name: 'Recolher painel', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(root, 'mobile.png') });
  assert.deepEqual(errors, []);
  if (process.env.AGEXA_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.AGEXA_SCREENSHOT_DIR, { recursive: true });
    for (const name of ['desktop.png', 'mobile.png'])
      fs.copyFileSync(
        path.join(root, name),
        path.join(process.env.AGEXA_SCREENSHOT_DIR, `phase2-${name}`),
      );
  }
  console.log(
    'PASS: private login, 8 real seated characters in 5 areas, task controls, suspension, SQLite persistence, reconnect, original editor, desktop/mobile',
  );
} finally {
  await browser?.close();
  await stop();
  fs.rmSync(root, { recursive: true, force: true });
}
