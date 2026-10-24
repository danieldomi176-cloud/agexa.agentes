import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

// Internal checks only. Do not print token-bearing URLs or returned state.
const base = 'http://127.0.0.1:3100';
const health = await fetch(`${base}/api/health`);
assert.equal(health.status, 200);
assert.equal((await health.json()).status, 'ok');
const page = await fetch(base);
assert.equal(page.status, 200);
assert.match(await page.text(), /<title>AGEXA AI OFFICE<\/title>/);
const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json();
assert.equal(manifest.name, 'AGEXA AI OFFICE');
const commercial = await fetch(`${base}/api/agexa/enabled`);
assert.equal(commercial.status, 200);
assert.equal((await commercial.json()).enabled, true);
assert.equal((await fetch(`${base}/api/agexa/state`)).status, 401);
await new Promise((resolve, reject) => {
  const ws = new WebSocket(`${base.replace('http:', 'ws:')}/ws`);
  const received = new Set();
  const required = [
    'characterSpritesLoaded',
    'furnitureAssetsLoaded',
    'existingAgents',
    'layoutLoaded',
  ];
  const timer = setTimeout(() => finish(new Error('Incomplete office bootstrap')), 10000);
  function finish(error) {
    clearTimeout(timer);
    ws.close();
    if (error) reject(error);
    else resolve();
  }
  ws.on('error', finish);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'webviewReady' })));
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.type === 'characterSpritesLoaded') assert.ok(message.characters.length > 0);
      if (message.type === 'furnitureAssetsLoaded') assert.ok(message.catalog.length > 0);
      if (message.type === 'layoutLoaded') assert.ok(message.layout);
      received.add(message.type);
      if (required.every((type) => received.has(type))) finish();
    } catch (error) {
      finish(error);
    }
  });
});
console.log(
  'PASS: HTTP health, private commercial API, Agexa page/manifest and real WebSocket office/assets bootstrap',
);
