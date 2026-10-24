import type { DatabaseSync } from 'node:sqlite';

import type { EmployeeId } from '../../../core/src/agexa.js';
import type {
  AgentMemory,
  AgexaKnowledge,
  IntelligenceConfig,
  SalesWorkflow,
} from '../../../core/src/intelligence.js';
import { DEFAULT_INTELLIGENCE, EMPTY_KNOWLEDGE } from '../../../core/src/intelligence.js';
import { validateIntelligenceConfig } from './ollama.js';

export function validateKnowledge(value: AgexaKnowledge): void {
  if (
    !value ||
    typeof value !== 'object' ||
    value.trialDays !== 7 ||
    typeof value.trialAvailable !== 'boolean'
  )
    throw new Error('Conhecimento comercial inválido');
  if (value.signupUrl !== null) {
    const url = new URL(value.signupUrl);
    if (url.protocol !== 'https:' || url.username || url.password || value.signupUrl.length > 500)
      throw new Error('URL oficial deve ser HTTPS sem credenciais');
  }
  if (value.trialAvailable && !value.signupUrl)
    throw new Error('Confirmar o URL oficial antes de ativar a oferta');
  for (const key of ['confirmedFeatures', 'approvedPrices', 'policies'] as const)
    if (
      !Array.isArray(value[key]) ||
      value[key].length > 20 ||
      value[key].some((s) => typeof s !== 'string' || !s.trim() || s.length > 300)
    )
      throw new Error(`Base de conhecimento inválida: ${key}`);
}
export class CommercialMemory {
  constructor(private readonly db: DatabaseSync) {
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
    if (version > 3) throw new Error('Versão do banco mais recente que esta aplicação');
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = new Set(
        db
          .prepare('PRAGMA table_info(tasks)')
          .all()
          .map((row) => row.name),
      );
      for (const [name, type] of Object.entries({
        workflowId: 'TEXT',
        stage: 'TEXT',
        dependencyIds: "TEXT NOT NULL DEFAULT '[]'",
        model: 'TEXT',
        durationMs: 'INTEGER',
      }))
        if (!existing.has(name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${type}`);
      db.exec(`CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, goal TEXT NOT NULL, input TEXT NOT NULL,
    status TEXT NOT NULL, planTaskId TEXT NOT NULL, createdAt TEXT NOT NULL, approvedAt TEXT,
    taskBudget INTEGER NOT NULL, inferenceBudget INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY AUTOINCREMENT, employeeId TEXT,
    taskId TEXT, kind TEXT NOT NULL, content TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS tasks_workflow ON tasks(workflowId);
    CREATE INDEX IF NOT EXISTS tasks_queue ON tasks(status,employeeId);
    `);
      if (version < 2) db.exec('PRAGMA user_version=2');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  config(): IntelligenceConfig {
    const saved = this.db.prepare("SELECT value FROM settings WHERE key='intelligence'").get();
    const config = {
      ...DEFAULT_INTELLIGENCE,
      ...(saved ? JSON.parse(String(saved.value)) : {}),
    } as IntelligenceConfig;
    validateIntelligenceConfig(config);
    return config;
  }
  saveConfig(config: IntelligenceConfig): void {
    validateIntelligenceConfig(config);
    this.setting('intelligence', config);
  }
  knowledge(): AgexaKnowledge {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='knowledge'").get();
    const value = row ? (JSON.parse(String(row.value)) as AgexaKnowledge) : { ...EMPTY_KNOWLEDGE };
    validateKnowledge(value);
    return value;
  }
  saveKnowledge(value: AgexaKnowledge): void {
    validateKnowledge(value);
    this.setting('knowledge', value);
  }
  private setting(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify(value));
  }
  add(
    kind: 'decision' | 'summary',
    content: string,
    employeeId: EmployeeId | null = null,
    taskId: string | null = null,
  ): void {
    if (!content.trim() || content.length > 2000)
      throw new Error('Memória deve conter 1–2000 caracteres');
    this.db
      .prepare('INSERT INTO memories(employeeId,taskId,kind,content,createdAt) VALUES (?,?,?,?,?)')
      .run(employeeId, taskId, kind, content, new Date().toISOString());
  }
  recent(employeeId?: EmployeeId): AgentMemory[] {
    return this.db
      .prepare(
        `SELECT * FROM memories ${employeeId ? "WHERE employeeId=? OR (employeeId IS NULL AND kind='decision')" : ''} ORDER BY id DESC LIMIT 20`,
      )
      .all(...(employeeId ? [employeeId] : [])) as unknown as AgentMemory[];
  }
  context(employeeId: EmployeeId, workflowId: string | null): AgentMemory[] {
    return this.db
      .prepare(
        `SELECT m.* FROM memories m WHERE
      (m.kind='decision' AND (m.employeeId=? OR m.employeeId IS NULL)) OR
      (m.kind='summary' AND m.taskId IN (SELECT id FROM tasks WHERE workflowId=? AND employeeId=?))
      ORDER BY m.id DESC LIMIT 4`,
      )
      .all(employeeId, workflowId, employeeId) as unknown as AgentMemory[];
  }
  workflows(): SalesWorkflow[] {
    return this.db
      .prepare('SELECT * FROM workflows ORDER BY createdAt DESC,rowid DESC LIMIT 50')
      .all()
      .map((row) => ({
        ...row,
        input: JSON.parse(String(row.input)),
      })) as unknown as SalesWorkflow[];
  }
  workflow(id: string): SalesWorkflow {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id=?').get(id);
    if (!row) throw new Error('Ordem Nexus inexistente');
    return { ...row, input: JSON.parse(String(row.input)) } as unknown as SalesWorkflow;
  }
}
