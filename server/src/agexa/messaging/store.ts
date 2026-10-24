import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  MessagingAudit,
  MessagingConversation,
  MessagingDetail,
  MessagingDraft,
  MessagingMessage,
  MessagingProviderId,
} from '../../../../core/src/messaging.js';
import { CrmError } from '../crm/error.js';
export const timestamp = (): string => new Date().toISOString();
export class MessagingStore {
  constructor(readonly db: DatabaseSync) {
    db.exec(`SAVEPOINT messaging_migration;
   CREATE TABLE IF NOT EXISTS messaging_connections(id TEXT PRIMARY KEY,config TEXT NOT NULL,updatedAt TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS messaging_conversations(id TEXT PRIMARY KEY,provider TEXT NOT NULL,remoteId TEXT NOT NULL,name TEXT NOT NULL,companyId TEXT REFERENCES crm_companies(id),owner TEXT NOT NULL,state TEXT NOT NULL,simulated INTEGER NOT NULL,interestedMessageId TEXT,acceptedMessageId TEXT,updatedAt TEXT NOT NULL,lastMessage TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',UNIQUE(provider,remoteId));
   CREATE TABLE IF NOT EXISTS messaging_messages(id TEXT PRIMARY KEY,conversationId TEXT NOT NULL REFERENCES messaging_conversations(id),provider TEXT NOT NULL,providerId TEXT,direction TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,simulated INTEGER NOT NULL,createdAt TEXT NOT NULL,UNIQUE(provider,providerId));
   CREATE TABLE IF NOT EXISTS messaging_drafts(id TEXT PRIMARY KEY,conversationId TEXT NOT NULL REFERENCES messaging_conversations(id),body TEXT NOT NULL,kind TEXT NOT NULL,employeeId TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,sourceMessageId TEXT NOT NULL,taskId TEXT UNIQUE,createdAt TEXT NOT NULL,UNIQUE(conversationId,version));
   CREATE TABLE IF NOT EXISTS messaging_approvals(id TEXT PRIMARY KEY,draftId TEXT NOT NULL REFERENCES messaging_drafts(id),decision TEXT NOT NULL,actor TEXT NOT NULL,createdAt TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS messaging_deliveries(id TEXT PRIMARY KEY,conversationId TEXT NOT NULL REFERENCES messaging_conversations(id),draftId TEXT NOT NULL UNIQUE REFERENCES messaging_drafts(id),messageId TEXT NOT NULL UNIQUE REFERENCES messaging_messages(id),status TEXT NOT NULL,providerId TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
   CREATE UNIQUE INDEX IF NOT EXISTS messaging_conversation_send_lock ON messaging_deliveries(conversationId) WHERE status IN ('sending','pending','reconciliation');
   CREATE TABLE IF NOT EXISTS messaging_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,conversationId TEXT REFERENCES messaging_conversations(id),action TEXT NOT NULL,detail TEXT NOT NULL,createdAt TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS messaging_assignments(id TEXT PRIMARY KEY,conversationId TEXT NOT NULL REFERENCES messaging_conversations(id),owner TEXT NOT NULL,reason TEXT NOT NULL,createdAt TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS messaging_events(provider TEXT NOT NULL,externalId TEXT NOT NULL,kind TEXT NOT NULL,createdAt TEXT NOT NULL,PRIMARY KEY(provider,externalId,kind));
   CREATE INDEX IF NOT EXISTS messaging_inbox ON messaging_conversations(provider,updatedAt);
   CREATE INDEX IF NOT EXISTS messaging_history ON messaging_messages(conversationId,createdAt);
   PRAGMA user_version=4; RELEASE messaging_migration;`);
    // No automatic replay of uncertain deliveries across restart.
    this.atomic(() => {
      const interrupted = db
        .prepare(
          "SELECT conversationId,draftId,messageId FROM messaging_deliveries WHERE status IN ('sending','pending')",
        )
        .all();
      db.exec(
        "UPDATE messaging_deliveries SET status='reconciliation' WHERE status IN ('sending','pending')",
      );
      for (const row of interrupted) {
        db.prepare("UPDATE messaging_drafts SET status='reconciliation' WHERE id=?").run(
          String(row.draftId),
        );
        db.prepare("UPDATE messaging_messages SET status='reconciliation' WHERE id=?").run(
          String(row.messageId),
        );
        db.prepare(
          "UPDATE messaging_conversations SET state='reconciliation',owner='ceo' WHERE id=?",
        ).run(String(row.conversationId));
        this.audit(
          'delivery_interrupted',
          'Envio sem confirmação após reinício; reconciliar manualmente, sem repetição.',
          String(row.conversationId),
        );
      }
    });
  }
  private seq = 0;
  atomic<T>(fn: () => T): T {
    const id = `msg_${++this.seq}`;
    this.db.exec(`SAVEPOINT ${id}`);
    try {
      const r = fn();
      this.db.exec(`RELEASE ${id}`);
      return r;
    } catch (e) {
      this.db.exec(`ROLLBACK TO ${id}; RELEASE ${id}`);
      throw e;
    }
  }
  audit(action: string, detail: string, conversationId: string | null = null): void {
    this.db
      .prepare(
        'INSERT INTO messaging_audit(conversationId,action,detail,createdAt) VALUES (?,?,?,?)',
      )
      .run(conversationId, action, detail.slice(0, 1000), timestamp());
  }
  audits(conversationId?: string): MessagingAudit[] {
    return this.db
      .prepare(
        `SELECT * FROM messaging_audit ${conversationId ? 'WHERE conversationId=?' : ''} ORDER BY id DESC LIMIT 100`,
      )
      .all(...(conversationId ? [conversationId] : [])) as unknown as MessagingAudit[];
  }
  conversation(id: string): MessagingConversation {
    const r = this.db.prepare('SELECT * FROM messaging_conversations WHERE id=?').get(id);
    if (!r) throw new CrmError('Conversa inexistente', 404);
    return { ...r, simulated: !!r.simulated } as unknown as MessagingConversation;
  }
  list(
    provider: MessagingProviderId,
    search = '',
    state = '',
    page = 1,
  ): { items: MessagingConversation[]; total: number; page: number } {
    const where =
      "provider=? AND (name LIKE ? ESCAPE '\\' OR remoteId LIKE ? ESCAPE '\\')" +
      (state ? ' AND state=?' : '');
    const q = '%' + search.slice(0, 200).replace(/[\\%_]/g, '\\$&') + '%';
    const values = [provider, q, q, ...(state ? [state] : [])];
    const ids = this.db
      .prepare(
        `SELECT id FROM messaging_conversations WHERE ${where} ORDER BY updatedAt DESC,rowid DESC LIMIT 30 OFFSET ?`,
      )
      .all(...values, (page - 1) * 30);
    return {
      items: ids.map((r) => this.conversation(String(r.id))),
      total: Number(
        this.db
          .prepare(`SELECT count(*) n FROM messaging_conversations WHERE ${where}`)
          .get(...values)?.n,
      ),
      page,
    };
  }
  detail(id: string, page = 1): MessagingDetail {
    return {
      conversation: this.conversation(id),
      messages: this.messages(id, page),
      drafts: this.db
        .prepare(
          'SELECT * FROM messaging_drafts WHERE conversationId=? ORDER BY version DESC LIMIT 50',
        )
        .all(id) as unknown as MessagingDraft[],
      events: this.audits(id),
      messagePage: page,
      messageTotal: Number(
        this.db.prepare('SELECT count(*) n FROM messaging_messages WHERE conversationId=?').get(id)
          ?.n,
      ),
    };
  }
  messages(id: string, page = 1): MessagingMessage[] {
    return this.db
      .prepare(
        'SELECT * FROM messaging_messages WHERE conversationId=? ORDER BY rowid DESC LIMIT 50 OFFSET ?',
      )
      .all(id, (page - 1) * 50)
      .reverse()
      .map((r) => ({ ...r, simulated: !!r.simulated })) as unknown as MessagingMessage[];
  }
  latestInbound(id: string): MessagingMessage {
    const row = this.db
      .prepare(
        "SELECT * FROM messaging_messages WHERE conversationId=? AND direction='inbound' ORDER BY rowid DESC LIMIT 1",
      )
      .get(id);
    if (!row) throw new CrmError('Não existe mensagem recebida');
    return { ...row, simulated: !!row.simulated } as unknown as MessagingMessage;
  }
  draft(id: string): MessagingDraft {
    const r = this.db.prepare('SELECT * FROM messaging_drafts WHERE id=?').get(id);
    if (!r) throw new CrmError('Rascunho inexistente', 404);
    return r as unknown as MessagingDraft;
  }
  addDraft(
    id: string,
    body: string,
    employeeId: MessagingDraft['employeeId'],
    mode: MessagingDraft['mode'],
    kind: MessagingDraft['kind'],
    taskId: string | null = null,
    sourceMessageId?: string,
  ): MessagingDraft {
    return this.atomic(() => {
      const key = randomUUID();
      const version = Number(
        this.db
          .prepare(
            'SELECT coalesce(max(version),0)+1 n FROM messaging_drafts WHERE conversationId=?',
          )
          .get(id)?.n,
      );
      this.db
        .prepare('INSERT INTO messaging_drafts VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          key,
          id,
          body,
          kind,
          employeeId,
          mode,
          'proposed',
          version,
          sourceMessageId ?? this.latestInbound(id).id,
          taskId,
          timestamp(),
        );
      this.audit(
        'draft_prepared',
        `${employeeId}: versão ${version}; ${mode}; apenas rascunho`,
        id,
      );
      return this.draft(key);
    });
  }
  receive(
    provider: MessagingProviderId,
    simulated: boolean,
    message: { id: string; remoteId: string; name: string; body: string },
  ): { conversation: MessagingConversation; message: MessagingMessage } | null {
    if (
      !message.id ||
      message.id.length > 300 ||
      !/^\d{8,15}@c\.us$/.test(message.remoteId) ||
      !message.body ||
      message.body.length > 6000
    )
      return null;
    return this.atomic(() => {
      if (
        this.db
          .prepare('SELECT 1 FROM messaging_events WHERE provider=? AND externalId=? AND kind=?')
          .get(provider, message.id, 'inbound')
      )
        return null;
      this.db
        .prepare('INSERT INTO messaging_events VALUES (?,?,?,?)')
        .run(provider, message.id, 'inbound', timestamp());
      let c = this.db
        .prepare('SELECT id FROM messaging_conversations WHERE provider=? AND remoteId=?')
        .get(provider, message.remoteId);
      if (!c) {
        const id = randomUUID();
        this.db
          .prepare(
            'INSERT INTO messaging_conversations(id,provider,remoteId,name,owner,state,simulated,updatedAt,lastMessage) VALUES (?,?,?,?,?,?,?,?,?)',
          )
          .run(
            id,
            provider,
            message.remoteId,
            message.name.slice(0, 200),
            'luna',
            'open',
            simulated ? 1 : 0,
            timestamp(),
            message.body.slice(0, 200),
          );
        c = { id };
      }
      const id = String(c.id);
      const key = randomUUID();
      this.db
        .prepare('INSERT INTO messaging_messages VALUES (?,?,?,?,?,?,?,?,?)')
        .run(
          key,
          id,
          provider,
          message.id,
          'inbound',
          message.body,
          'received',
          simulated ? 1 : 0,
          timestamp(),
        );
      this.db
        .prepare('UPDATE messaging_conversations SET lastMessage=?,updatedAt=? WHERE id=?')
        .run(message.body.slice(0, 200), timestamp(), id);
      this.audit(
        'message_received',
        'Mensagem recebida do provider; conteúdo externo não confiável.',
        id,
      );
      return {
        conversation: this.conversation(id),
        message: {
          id: key,
          conversationId: id,
          providerId: message.id,
          direction: 'inbound',
          body: message.body,
          status: 'received',
          simulated,
          createdAt: timestamp(),
        },
      };
    });
  }
  assign(
    id: string,
    owner: MessagingConversation['owner'],
    reason: string,
    state: MessagingConversation['state'] = 'human',
  ): void {
    this.conversation(id);
    this.db
      .prepare('UPDATE messaging_conversations SET owner=?,state=?,updatedAt=? WHERE id=?')
      .run(owner, state, timestamp(), id);
    this.db
      .prepare('INSERT INTO messaging_assignments VALUES (?,?,?,?,?)')
      .run(randomUUID(), id, owner, reason, timestamp());
    this.audit(owner === 'ceo' ? 'assigned_ceo' : 'conversation_assigned', reason, id);
  }
}
