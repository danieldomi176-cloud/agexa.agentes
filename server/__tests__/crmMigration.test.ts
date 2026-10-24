import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { expect, it } from 'vitest';

import { SalesEngine } from '../src/agexa/engine.js';

it('migrates a v2 database and preserves every earlier identifier and business record', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-migration-'));
  let engine = new SalesEngine(root);
  try {
    const task = engine.create({
      employeeId: 'nexus',
      kind: 'prepare_brief',
      objective: 'Decisão preexistente da Fase 2',
      input: { authorized: true },
    });
    engine.setEmployee('nexus', true);
    await engine.tick();
    engine.addDecision('Decisão autorizada da Fase 3', 'maya');
    engine.close();
    let db = new DatabaseSync(path.join(root, 'sales.sqlite'));
    db.exec('PRAGMA foreign_keys=OFF');
    for (const row of db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'crm_%'")
      .all())
      db.exec(`DROP TABLE "${row.name}"`);
    db.exec('PRAGMA user_version=2');
    const tables = ['tasks', 'employees', 'settings', 'events', 'workflows', 'memories'];
    const before = Object.fromEntries(
      tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
    );
    const digest = createHash('sha256').update(JSON.stringify(before)).digest('hex');
    db.close();
    engine = new SalesEngine(root);
    expect(engine.getTask(task.id)).toMatchObject({
      id: task.id,
      status: 'completed',
      objective: 'Decisão preexistente da Fase 2',
    });
    expect(engine.crm.snapshot().companies).toHaveLength(0);
    engine.close();
    db = new DatabaseSync(path.join(root, 'sales.sqlite'), { readOnly: true });
    const after = Object.fromEntries(
      tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
    );
    expect(createHash('sha256').update(JSON.stringify(after)).digest('hex')).toBe(digest);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(4);
    db.close();
    engine = new SalesEngine(root);
    expect(engine.crm.snapshot().companies).toHaveLength(0);
  } finally {
    engine.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
