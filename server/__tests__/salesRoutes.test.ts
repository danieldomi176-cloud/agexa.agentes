import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { AgentStateStore } from '../src/agentStateStore.js';
import { SalesEngine } from '../src/agexa/engine.js';
import { createHttpServer } from '../src/httpServer.js';
import { sameStandaloneAccess } from '../src/serverConfig.js';

let root: string;
let app: FastifyInstance;
let engine: SalesEngine;
let port: number;
const token = 'test-only-sales-administrator-token';
const headers = { authorization: `Bearer ${token}`, host: '127.0.0.1' };
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agexa-routes-'));
  vi.stubEnv('AGEXA_DATA_DIR', root);
  engine = new SalesEngine(root);
  const server = await createHttpServer({
    embedded: true,
    token,
    store: new AgentStateStore(),
    salesEngine: engine,
    salesLayout: { version: 1, cols: 1, rows: 1, tiles: [1], furniture: [] },
  });
  app = server.app;
  port = server.port;
});
afterEach(async () => {
  await app.close();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
const input = {
  employeeId: 'nexus',
  kind: 'prepare_brief',
  objective: 'Preparar plano comercial',
  input: { authorized: true },
};

describe('Private sales administration', () => {
  it('never reuses a phase-one server as a commercial backend', () => {
    const base = { terminal: false, host: '127.0.0.1', allowedHosts: [] };
    expect(sameStandaloneAccess(base, { ...base, sales: true })).toBe(false);
    expect(sameStandaloneAccess({ ...base, sales: true }, { ...base, sales: true })).toBe(true);
  });
  it('does not disclose employees or task data to unauthenticated or wrong-origin callers', async () => {
    expect((await app.inject({ url: '/api/agexa/state' })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/api/agexa/state', headers: { ...headers, host: 'evil.example' } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: '/api/agexa/state',
          headers: { ...headers, origin: 'https://evil.example' },
        })
      ).statusCode,
    ).toBe(401);
    const valid = await app.inject({ url: '/api/agexa/state', headers });
    expect(valid.statusCode).toBe(200);
    expect(valid.json().employees).toHaveLength(8);
    expect(valid.headers['cache-control']).toBe('no-store');
  });
  it('validates controls, approval and transfer through authenticated HTTP', async () => {
    expect(
      (await app.inject({ method: 'POST', url: '/api/agexa/tasks', payload: input })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa/tasks',
          headers,
          payload: { ...input, kind: 'shell' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa/tasks',
          headers,
          payload: { ...input, input: {} },
        })
      ).statusCode,
    ).toBe(400);
    const created = await app.inject({
      method: 'POST',
      url: '/api/agexa/tasks',
      headers,
      payload: { ...input, requiresApproval: true },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/agexa/tasks/${id}/approve`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    await app.inject({
      method: 'POST',
      url: '/api/agexa/employees/nexus',
      headers,
      payload: { enabled: true },
    });
    await engine.tick();
    expect(engine.getTask(id).status).toBe('completed');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/agexa/tasks/${id}/transfer`,
          headers,
          payload: { recipient: 'atlas' },
        })
      ).statusCode,
    ).toBe(200);
    await app.inject({
      method: 'POST',
      url: '/api/agexa/operations',
      headers,
      payload: { suspended: true },
    });
    expect(engine.suspended).toBe(true);
  });
  it('backs up a customized layout before explicit replacement and rejects unconfirmed reset', async () => {
    // Resolve the canonical file name through actual persistence, not an assumed name.
    const { writeLayoutToFile, readLayoutFromFile } = await import('../src/layoutPersistence.js');
    writeLayoutToFile({ version: 1, custom: true });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa/layout',
          headers,
          payload: { confirm: false },
        })
      ).statusCode,
    ).toBe(400);
    const result = await app.inject({
      method: 'POST',
      url: '/api/agexa/layout',
      headers,
      payload: { confirm: true },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().backupCreated).toBe(true);
    const backup = fs.readdirSync(root).find((name) => name.startsWith('layout-backup-'))!;
    expect(JSON.parse(fs.readFileSync(path.join(root, backup), 'utf8')).custom).toBe(true);
    expect(readLayoutFromFile()?.cols).toBe(1);
  });
  it('rejects the private WebSocket without a token and streams persisted state to the CEO', async () => {
    const rejected = new WebSocket(`ws://127.0.0.1:${port}/api/agexa/events`);
    const code = await new Promise<number>((resolve) => {
      rejected.on('unexpected-response', (_req, res) => {
        resolve(res.statusCode!);
        res.resume();
        rejected.terminate();
      });
      rejected.on('error', () => {});
    });
    expect(code).toBe(401);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/agexa/events?token=${token}`);
    const snapshots: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Missing sales snapshot')), 2000);
      socket.on('message', (data) => {
        snapshots.push(JSON.parse(data.toString()));
        clearTimeout(timer);
        resolve();
      });
      socket.on('error', reject);
    });
    expect((snapshots[0] as { employees: unknown[] }).employees).toHaveLength(8);
    const update = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Missing sales update')), 2000);
      socket.once('message', (data) => {
        expect(JSON.parse(data.toString()).tasks).toHaveLength(1);
        clearTimeout(timer);
        resolve();
      });
    });
    engine.create(input as Parameters<SalesEngine['create']>[0]);
    await update;
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.close();
    });
  });
});
