import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { ceoCanonical } from '../../../../core/src/ceoBridge.js';

export class CeoError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
/** Infrastructure records inside the SAME sales.sqlite. Never stores keys or request bodies. */
export class CeoStore {
  constructor(readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS ceo_nonces(nonce TEXT PRIMARY KEY,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ceo_limits(actor TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ceo_commands(id TEXT PRIMARY KEY,actor TEXT NOT NULL,digest TEXT NOT NULL,status TEXT NOT NULL,http INTEGER,response TEXT,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ceo_audit(id TEXT PRIMARY KEY,at TEXT NOT NULL,actor TEXT NOT NULL,operation TEXT NOT NULL,requestId TEXT NOT NULL,status INTEGER NOT NULL);`);
  }
  consume(actor: string, nonce: string, now = Date.now()): void {
    const minute = Math.floor(now / 60000);
    this.db.exec('SAVEPOINT ceo_auth');
    try {
      this.db.prepare('DELETE FROM ceo_nonces WHERE expires<?').run(now);
      if (this.db.prepare('SELECT 1 FROM ceo_nonces WHERE nonce=?').get(nonce))
        throw new CeoError('Replay recusado', 409);
      const count = this.db.prepare('SELECT window,count FROM ceo_limits WHERE actor=?').get(actor);
      if (count?.window === minute && Number(count.count) >= 60)
        throw new CeoError('Limite de pedidos', 429);
      this.db
        .prepare('INSERT OR REPLACE INTO ceo_limits VALUES (?,?,?)')
        .run(actor, minute, count?.window === minute ? Number(count.count) + 1 : 1);
      this.db.prepare('INSERT INTO ceo_nonces VALUES (?,?)').run(nonce, now + 180000);
      this.db.exec('RELEASE ceo_auth');
    } catch (error) {
      this.db.exec('ROLLBACK TO ceo_auth; RELEASE ceo_auth');
      throw error;
    }
  }
  reserve(id: string, actor: string, input: string): { http: number; response: string } | null {
    const digest = createHash('sha256')
      .update(ceoCanonical(JSON.parse(input)))
      .digest('hex');
    const previous = this.db.prepare('SELECT * FROM ceo_commands WHERE id=?').get(id);
    if (previous) {
      if (previous.actor !== actor || previous.digest !== digest)
        throw new CeoError('ID já usado com outro conteúdo', 409);
      if (
        previous.status !== 'done' ||
        typeof previous.response !== 'string' ||
        Number(previous.created) < Date.now() - 86400000
      )
        throw new CeoError(
          'Resultado incerto ou expirado; rever auditoria antes de nova ação',
          409,
        );
      return { http: Number(previous.http), response: previous.response };
    }
    this.db
      .prepare('UPDATE ceo_commands SET response=NULL WHERE created<? AND response IS NOT NULL')
      .run(Date.now() - 86400000);
    this.db
      .prepare('INSERT INTO ceo_commands VALUES (?,?,?,?,?,?,?)')
      .run(id, actor, digest, 'started', null, null, Date.now());
    return null;
  }
  finish(id: string, http: number, response: string): void {
    this.db
      .prepare("UPDATE ceo_commands SET status='done',http=?,response=? WHERE id=?")
      .run(http, response, id);
  }
  audit(actor: string, operation: string, requestId: string, status: number): void {
    this.db
      .prepare('INSERT INTO ceo_audit VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), new Date().toISOString(), actor, operation, requestId, status);
  }
  recent(): unknown[] {
    return this.db.prepare('SELECT * FROM ceo_audit ORDER BY rowid DESC LIMIT 100').all();
  }
}
