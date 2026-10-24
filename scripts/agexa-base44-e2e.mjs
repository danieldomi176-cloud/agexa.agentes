/** Real isolated Office backend, no external Base44/AI/WhatsApp calls or commercial fixtures. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { chromium } from 'playwright';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agexa-base44-browser-'));
const probe = net.createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
let server, browser;
try {
  server = spawn(
    process.execPath,
    ['dist/cli.js', '--agexa', '--host', '127.0.0.1', '--port', String(port), '--no-terminal'],
    {
      env: {
        ...process.env,
        AGEXA_DATA_DIR: root,
        AGEXA_BASE44_EVENT_SECRET: '',
        AGEXA_BASE44_EVENT_SECRET_FILE: '',
        AGEXA_GEMINI_API_KEY: '',
        AGEXA_INFERENCE_TEST_MODE: '0',
        AGEXA_MESSAGING_TEST_MODE: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const token = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('Office startup timeout')), 20000);
    server.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/\/\?token=([A-Za-z0-9-]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    server.stderr.resume();
    server.once('exit', () => {
      clearTimeout(timer);
      reject(Error('Office exited'));
    });
  });
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(base + '/api/agexa/conversion')).status, 401);
  const initial = await (await fetch(base + '/api/agexa/state', { headers })).json();
  assert.equal(initial.employees.length, 8);
  browser = await chromium.launch(
    process.env.AGEXA_CHROMIUM_PATH
      ? { executablePath: process.env.AGEXA_CHROMIUM_PATH, args: ['--no-sandbox'] }
      : {},
  );
  const page = await browser.newPage({ viewport: { width: 1550, height: 1100 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByLabel('Token administrativo').fill(token);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: 'Conversões', exact: true }).click();
  await page.getByRole('button', { name: 'Integração Base44', exact: true }).click();
  await page
    .getByLabel('ID interno da aplicação Base44', { exact: true })
    .fill('6970e6a789a360f2b09ea09d');
  await page.getByRole('button', { name: 'Guardar integração', exact: true }).click();
  await page
    .getByLabel('Prontidão da integração Base44')
    .getByText('App ID: 6970e6a789a360f2b09ea09d', { exact: true })
    .waitFor();
  assert.ok(
    await page
      .getByRole('button', { name: 'Sincronizar feed autorizado', exact: true })
      .isDisabled(),
  );
  assert.equal(await page.locator('input[type=password]').count(), 0);
  await page.reload();
  await page.getByRole('button', { name: 'Conversões', exact: true }).click();
  await page.getByRole('button', { name: 'Integração Base44', exact: true }).click();
  assert.equal(
    await page.getByLabel('ID interno da aplicação Base44', { exact: true }).inputValue(),
    '6970e6a789a360f2b09ea09d',
  );
  const saved = await (await fetch(base + '/api/agexa/state', { headers })).json();
  assert.equal(saved.conversion.integration.secretStatus, 'missing');
  assert.equal(saved.conversion.integration.lastSync, null);
  assert.equal(saved.conversion.config.endpoint, null);
  assert.equal(saved.conversion.accounts.length, 0);
  assert.equal(saved.conversion.config.referenceSupported, false);
  const screenshots = process.env.AGEXA_SCREENSHOT_DIR;
  if (screenshots) {
    fs.mkdirSync(screenshots, { recursive: true });
    await page.locator('.agexa-panel').evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.screenshot({ path: path.join(screenshots, 'base44-setup-desktop.png') });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  if (screenshots) {
    await page
      .getByRole('heading', { name: 'AgexaBase44Connector', exact: true })
      .evaluate((node) => node.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(screenshots, 'base44-setup-mobile.png') });
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: isolated Office desktop/mobile, eight employees, saved App ID, admin boundary, missing-key/endpoint sync block and reload. No real Base44 connection.',
  );
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit');
  }
  fs.rmSync(root, { recursive: true, force: true });
}
