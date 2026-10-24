import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CreateSalesTask, InferenceAdapter } from '../../core/src/agexa.js';
import { SalesEngine } from '../src/agexa/engine.js';

let root: string;
let engine: SalesEngine;
const task = (overrides: Partial<CreateSalesTask> = {}): CreateSalesTask => ({
  employeeId: 'nexus',
  kind: 'prepare_brief',
  objective: 'Organizar oportunidades autorizadas na Beira',
  input: { authorized: true },
  ...overrides,
});
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agexa-engine-'));
  engine = new SalesEngine(root);
});
afterEach(() => {
  engine.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Agexa persistent sales engine', () => {
  it('provides eight permanent identities without claiming inference or active work', () => {
    const state = engine.snapshot();
    expect(state.employees).toHaveLength(8);
    expect(new Set(state.employees.map((e) => e.characterId)).size).toBe(8);
    expect(new Set(state.employees.map((e) => e.seatId)).size).toBe(8);
    expect(state.employees.every((e) => !e.enabled && e.status === 'paused')).toBe(true);
    expect(state.inference.connected).toBe(false);
  });
  it('persists a paused queue and resumes real structured work after restart', async () => {
    const queued = engine.create(task());
    await engine.tick();
    expect(engine.getTask(queued.id).status).toBe('queued');
    engine.close();
    engine = new SalesEngine(root);
    expect(engine.getTask(queued.id).objective).toBe(queued.objective);
    engine.setEmployee('nexus', true);
    await engine.tick();
    const done = engine.getTask(queued.id);
    expect(done.status).toBe('completed');
    expect(done.result).toMatchObject({ mode: 'structured_brief', inference: false });
    expect(done.startedAt).toBeTruthy();
    expect(done.finishedAt).toBeTruthy();
    expect(engine.snapshot().events.some((e) => e.action === 'task_completed')).toBe(true);
  });
  it('gates approval and blocks disconnected inference instead of fabricating output', async () => {
    engine.setEmployee('nexus', true);
    const approval = engine.create(task({ requiresApproval: true }));
    await engine.tick();
    expect(engine.getTask(approval.id).status).toBe('awaiting_approval');
    engine.approve(approval.id);
    await engine.tick();
    expect(engine.getTask(approval.id).status).toBe('completed');
    const ai = engine.create(task({ kind: 'ai_request' }));
    await engine.tick();
    expect(engine.getTask(ai.id)).toMatchObject({
      status: 'blocked',
      result: null,
      startedAt: null,
    });
  });
  it('computes transparent qualification only from supplied data and records missing-data errors', async () => {
    engine.setEmployee('atlas', true);
    const good = engine.create(
      task({
        employeeId: 'atlas',
        kind: 'qualify_company',
        input: {
          authorized: true,
          company: 'Empresa de teste',
          source: 'Dados autorizados pelo CEO',
          usesAppointments: true,
          organizationNeed: true,
          inMozambique: true,
          contactConsent: false,
        },
      }),
    );
    const bad = engine.create(task({ employeeId: 'atlas', kind: 'qualify_company' }));
    await engine.tick();
    expect(engine.getTask(good.id).result).toMatchObject({
      score: 90,
      contactPermitted: false,
      inference: false,
    });
    expect(engine.getTask(bad.id)).toMatchObject({ status: 'error', result: null });
    expect(engine.getTask(bad.id).error).toContain('fonte');
  });
  it('transfers a completed structured result exactly once to each recipient', async () => {
    engine.setEmployee('nexus', true);
    const initial = engine.create(task());
    await engine.tick();
    const next = engine.transfer(initial.id, 'atlas');
    expect(engine.transfer(initial.id, 'atlas').id).toBe(next.id);
    expect(next.parentId).toBe(initial.id);
    expect(next.input.upstreamResult).toEqual(engine.getTask(initial.id).result);
    expect(engine.snapshot().tasks).toHaveLength(2);
    expect(() => engine.transfer(initial.id, 'nexus')).toThrow('outro');
  });
  it('rejects unapproved context, arbitrary tool kinds and incorrect role permissions', () => {
    expect(() => engine.create(task({ input: { authorized: false } }))).toThrow('autorizados');
    expect(() => engine.create(task({ kind: 'send_message' as CreateSalesTask['kind'] }))).toThrow(
      'não permitida',
    );
    expect(() => engine.create(task({ kind: 'qualify_company' }))).toThrow('Atlas');
    expect(() => engine.create(task({ kind: 'sales_report' }))).toThrow('Orion');
    expect(() => engine.create(task({ priority: 100 }))).toThrow('Prioridade');
  });
  it('suspends durable operations and respects individual pause when resumed', async () => {
    engine.setEmployee('nexus', true);
    const queued = engine.create(task());
    engine.suspend(true);
    await engine.tick();
    expect(engine.getTask(queued.id).status).toBe('queued');
    engine.close();
    engine = new SalesEngine(root);
    expect(engine.suspended).toBe(true);
    engine.setEmployee('nexus', false);
    engine.suspend(false);
    await engine.tick();
    expect(engine.getTask(queued.id).status).toBe('queued');
    engine.setEmployee('nexus', true);
    await engine.tick();
    expect(engine.getTask(queued.id).status).toBe('completed');
  });
  it('reports real task metrics and keeps unknown sales conversions explicitly unknown', async () => {
    engine.setEmployee('orion', true);
    const report = engine.create(task({ employeeId: 'orion', kind: 'sales_report' }));
    await engine.tick();
    expect(engine.getTask(report.id).result).toMatchObject({
      mode: 'database_report',
      registrations: null,
      payingCustomers: null,
      revenue: null,
    });
  });
  it('does not open the same live data directory twice', () => {
    expect(() => new SalesEngine(root)).toThrow('utilização');
  });
  it('recovers an interrupted claim as an error rather than repeating uncertain work', () => {
    const pending = engine.create(task());
    engine.close();
    const db = new DatabaseSync(path.join(root, 'sales.sqlite'));
    db.prepare("UPDATE tasks SET status='running' WHERE id=?").run(pending.id);
    db.close();
    engine = new SalesEngine(root);
    expect(engine.getTask(pending.id)).toMatchObject({ status: 'error', result: null });
  });
  it('limits parallel inference and discards late results after emergency suspension', async () => {
    engine.close();
    const pending: Array<(value: Record<string, unknown>) => void> = [];
    const provider: InferenceAdapter = {
      name: 'test-only',
      connected: true,
      run: () => new Promise((resolve) => pending.push(resolve)),
    };
    engine = new SalesEngine(root, provider);
    for (const id of ['nexus', 'atlas', 'maya'] as const) engine.setEmployee(id, true);
    const one = engine.create(task({ kind: 'ai_request' }));
    const two = engine.create(task({ employeeId: 'atlas', kind: 'ai_request' }));
    const three = engine.create(task({ employeeId: 'maya', kind: 'ai_request' }));
    const same = engine.create(task({ kind: 'ai_request' }));
    await engine.tick();
    expect(pending).toHaveLength(2);
    expect(engine.getTask(one.id).status).toBe('running');
    expect(engine.getTask(two.id).status).toBe('running');
    expect(engine.getTask(three.id).status).toBe('queued');
    expect(engine.getTask(same.id).status).toBe('queued');
    engine.suspend(true);
    for (const resolve of pending) resolve({ shouldNotPersist: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(engine.getTask(one.id)).toMatchObject({ status: 'cancelled', result: null });
    expect(engine.getTask(two.id)).toMatchObject({ status: 'cancelled', result: null });
  });
});
