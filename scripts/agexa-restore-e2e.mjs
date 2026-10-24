/** Clean source/dependency installation on this host. NEVER claims a separate-machine restore. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

assert.equal(Number(process.versions.node.split('.')[0]), 22, 'Use Node 22');
const source = process.cwd();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agexa-clean-restore-'));
const checkout = path.join(root, 'source'),
  data = path.join(root, 'fixture-data'),
  restored = path.join(root, 'restored-data');
fs.mkdirSync(checkout, { mode: 0o700 });
fs.mkdirSync(data, { mode: 0o700 });
fs.mkdirSync(restored, { mode: 0o700 });
const env = {
  ...process.env,
  PUPPETEER_SKIP_DOWNLOAD: 'true',
  HUSKY: '0',
  AGEXA_DATA_DIR: data,
  AGEXA_INFERENCE_TEST_MODE: '0',
  AGEXA_MESSAGING_TEST_MODE: '0',
};
let server, token, base;
function hashes(dir) {
  const db = new DatabaseSync(path.join(dir, 'sales.sqlite'), { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    return Object.fromEntries(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map(({ name }) => [
          name,
          createHash('sha256')
            .update(
              JSON.stringify(
                db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all(),
              ),
            )
            .digest('hex'),
        ]),
    );
  } finally {
    db.close();
  }
}
async function command(args, log) {
  const fd = fs.openSync(path.join(root, log), 'wx', 0o600);
  try {
    const child = spawn('npm', args, { cwd: checkout, env, stdio: ['ignore', fd, fd] });
    const timer = setTimeout(() => child.kill('SIGTERM'), 600000);
    const [code] = await once(child, 'exit');
    clearTimeout(timer);
    assert.equal(code, 0, `npm ${args.join(' ')} failed; inspect private ${path.join(root, log)}`);
  } finally {
    fs.closeSync(fd);
  }
}
async function start(directory, rotate = false) {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  base = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    [
      'dist/cli.js',
      '--agexa',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--no-terminal',
      ...(rotate ? ['--rotate-token'] : []),
    ],
    {
      cwd: checkout,
      env: { ...env, AGEXA_DATA_DIR: directory },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  server.stderr.resume();
  await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(Error('Clean startup timeout')), 20000);
    server.stdout.on('data', (b) => {
      out += b.toString();
      const m = out.match(/\/\?token=([A-Za-z0-9-]+)/);
      if (m) {
        token = m[1];
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('exit', () => {
      clearTimeout(timer);
      reject(Error('Clean server exited'));
    });
  });
}
async function stop() {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit');
  }
}
async function api(route, payload) {
  const r = await fetch(`${base}/api/agexa/${route}`, {
    method: payload ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const body = await r.json();
  assert.ok(r.ok, `${route}: ${r.status} ${body.error ?? ''}`);
  return body;
}
try {
  const files = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: source, maxBuffer: 16 * 1024 * 1024 },
  )
    .toString()
    .split('\0')
    .filter(Boolean);
  for (const file of new Set(files)) {
    assert.ok(!path.isAbsolute(file) && !file.split('/').includes('..'));
    const from = path.join(source, file);
    if (!fs.existsSync(from)) continue;
    assert.ok(fs.lstatSync(from).isFile(), `Unexpected nonregular source ${file}`);
    const to = path.join(checkout, file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  assert.ok(!fs.existsSync(path.join(checkout, 'node_modules')));
  const lock = createHash('sha256')
    .update(fs.readFileSync(path.join(checkout, 'package-lock.json')))
    .digest('hex');
  await command(
    [
      'ci',
      '--no-audit',
      '--no-fund',
      '--cache',
      process.env.AGEXA_NPM_CACHE ??
        (fs.existsSync('/workspace/.npm-cache')
          ? '/workspace/.npm-cache'
          : path.join(root, 'npm-cache')),
    ],
    'install.log',
  );
  assert.equal(
    createHash('sha256')
      .update(fs.readFileSync(path.join(checkout, 'package-lock.json')))
      .digest('hex'),
    lock,
  );
  await command(['run', 'build'], 'build.log');
  console.log('PASS: clean source, npm ci, unchanged lockfile and full build on SAME host');
  await start(data);
  assert.equal((await fetch(base + '/api/agexa/state')).status, 401);
  assert.equal((await fetch(base + '/api/agexa/readiness')).status, 401);
  assert.equal((await fetch(base + '/api/agexa/enabled').then((r) => r.json())).phase, 7);
  const initial = await api('state');
  assert.equal(initial.employees.length, 8);
  assert.equal(initial.crm.totalCompanies, 0);
  if (process.env.AGEXA_CHROMIUM_PATH) {
    const { chromium } = await import('playwright');
    // Rendering fixtures only. Production WhatsApp always keeps its sandbox.
    const browser = await chromium.launch({
      executablePath: process.env.AGEXA_CHROMIUM_PATH,
      args: ['--no-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.addInitScript(() => {
        window.__PIXEL_AGENTS_E2E = true;
      });
      await page.goto(base);
      await page.getByLabel('Token administrativo').fill(token);
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await page.waitForFunction(
        () =>
          window.__pixelAgentsTestHooks?.getCharacters?.().filter((c) => c.commercialStatus)
            .length === 8,
      );
      assert.ok((await page.locator('canvas').count()) > 0);
      console.log(
        'PASS: fresh-build pixel office renders all eight employees in local fixture browser (not WhatsApp sandbox proof)',
      );
    } finally {
      await browser.close();
    }
  } else
    console.log(
      'SKIP: pixel rendering in fresh build requires AGEXA_CHROMIUM_PATH; WebSocket assets are checked separately',
    );
  const sourceRecord = await api('crm/sources', {
    name: 'RESTORE FIXTURE',
    kind: 'manual',
    url: null,
    termsUrl: null,
    permissionEvidence: 'Isolated authorized test',
    attribution: 'TEST ONLY',
    enabled: true,
    termsReviewed: true,
    commercialReuseAllowed: true,
  });
  await api('crm/import', {
    sourceId: sourceRecord.id,
    authorized: true,
    businessOnly: true,
    simulated: true,
    records: [
      {
        name: 'BARBEARIA FICTÍCIA RESTORE',
        sector: 'barbearia',
        city: 'Beira',
        country: 'Moçambique',
      },
    ],
  });
  let state;
  const deadline = Date.now() + 20000;
  do {
    state = await api('state');
    if (state.crm.totalCompanies === 1) break;
    assert.ok(Date.now() < deadline);
    await new Promise((r) => setTimeout(r, 25));
  } while (true);
  const company = state.crm.companies[0];
  await api('conversion/manual', {
    companyId: company.id,
    confirmed: true,
    fact: {
      eventId: 'restore-account-fixture',
      appId: 'manual-agexa',
      kind: 'account_created',
      occurredAt: new Date(Date.now() - 1000).toISOString(),
      accountId: 'restore-fixture',
      evidence: 'FICTÍCIO: recuperação isolada.',
    },
  });
  assert.equal((await api('state')).conversion.accounts[0].origin, 'simulated');
  // Existing bootstrap asserts actual sprites, furniture and layout over WebSocket.
  const { WebSocket } = await import('ws');
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
    const required = new Set([
      'characterSpritesLoaded',
      'furnitureAssetsLoaded',
      'existingAgents',
      'layoutLoaded',
    ]);
    const timer = setTimeout(() => {
      ws.close();
      reject(Error('Office WebSocket timeout'));
    }, 10000);
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'webviewReady' })));
    ws.on('message', (v) => {
      required.delete(JSON.parse(v.toString()).type);
      if (!required.size) {
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    });
  });
  await api('readiness/backup', {});
  const backupDir = path.join(data, 'backups');
  const copy = path.join(backupDir, fs.readdirSync(backupDir)[0]);
  // Compare to the snapshot itself: post-backup audit rows are intentionally newer.
  fs.copyFileSync(copy, path.join(restored, 'sales.sqlite'));
  fs.chmodSync(path.join(restored, 'sales.sqlite'), 0o600);
  const fromBackup = hashes(restored);
  const before = hashes(data);
  await stop();
  const previousToken = token;
  await start(data, true);
  assert.equal(
    (
      await fetch(base + '/api/agexa/state', {
        headers: { Authorization: `Bearer ${previousToken}` },
      })
    ).status,
    401,
  );
  assert.deepEqual(hashes(data), before);
  await stop();
  await start(restored);
  assert.deepEqual(hashes(restored), fromBackup);
  const after = await api('state');
  assert.equal(after.crm.companies[0].id, company.id);
  assert.equal(after.conversion.accounts[0].externalId, 'restore-fixture');
  assert.equal(after.employees.length, 8);
  assert.equal((await fetch(base + '/api/agexa/state')).status, 401);
  await stop();
  console.log(
    'PASS: private config, schema v5, auth, office/assets WebSocket, simulated CRM/conversion, all-table hashes across restart and isolated backup recovery. Independent machine NOT tested. No operational data used.',
  );
  fs.rmSync(root, { recursive: true, force: true });
} catch (error) {
  console.error(`FAILED: isolated fixture logs retained privately at ${root}`);
  throw error;
} finally {
  await stop();
}
