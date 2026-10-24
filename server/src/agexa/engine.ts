import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  CreateSalesTask,
  EmployeeId,
  InferenceAdapter,
  SalesEmployee,
  SalesSnapshot,
  SalesTask,
} from '../../../core/src/agexa.js';
import { EMPLOYEES, SALES_OBJECTIVE, salesCharacterId } from '../../../core/src/agexa.js';

export class SalesError extends Error {
  constructor(
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}

/** No hidden fallback, fabricated output or implicit paid provider. */
export class DisconnectedInference implements InferenceAdapter {
  readonly name = 'none';
  readonly connected = false;
  async run(): Promise<Record<string, unknown>> {
    throw new Error('Inferência indisponível — integrar Ollama na Fase 3');
  }
}

type Row = Record<string, unknown>;
const now = (): string => new Date().toISOString();
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Single writer, atomic SQLite transactions, durable queue and an auditable event log. */
export class SalesEngine extends EventEmitter {
  private readonly db: DatabaseSync;
  private readonly lock: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly active = new Map<string, AbortController>();
  private closed = false;
  private busy = false;

  constructor(
    readonly directory: string,
    private readonly inference: InferenceAdapter = new DisconnectedInference(),
  ) {
    super();
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.lock = path.join(directory, 'sales.lock');
    this.acquireLock();
    try {
      const databasePath = path.join(directory, 'sales.sqlite');
      const fd = fs.openSync(databasePath, 'a', 0o600);
      fs.closeSync(fd);
      fs.chmodSync(databasePath, 0o600);
      this.db = new DatabaseSync(databasePath);
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS employees (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, employeeId TEXT NOT NULL REFERENCES employees(id),
          kind TEXT NOT NULL, objective TEXT NOT NULL, input TEXT NOT NULL, status TEXT NOT NULL,
          priority INTEGER NOT NULL, createdAt TEXT NOT NULL, startedAt TEXT, finishedAt TEXT,
          result TEXT, error TEXT, parentId TEXT REFERENCES tasks(id), approvedAt TEXT,
          UNIQUE(parentId, employeeId));
        CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
          employeeId TEXT, taskId TEXT, action TEXT NOT NULL, detail TEXT NOT NULL);
        INSERT OR IGNORE INTO settings VALUES ('suspended','0');
        PRAGMA user_version=1;`);
      for (const employee of EMPLOYEES)
        this.db.prepare('INSERT OR IGNORE INTO employees(id) VALUES (?)').run(employee.id);
      // Crash recovery never replays an uncertain inference automatically.
      this.transaction(() => {
        const interrupted = this.db
          .prepare("SELECT id, employeeId FROM tasks WHERE status='running'")
          .all();
        for (const row of interrupted) {
          this.db
            .prepare(
              "UPDATE tasks SET status='error', error='Execução interrompida pelo reinício; requer nova tarefa', finishedAt=? WHERE id=?",
            )
            .run(now(), String(row.id));
          this.event(
            'task_interrupted',
            'Execução anterior interrompida; nenhuma repetição automática',
            row.employeeId as EmployeeId,
            String(row.id),
          );
        }
      });
    } catch (error) {
      fs.rmSync(this.lock, { force: true });
      throw error;
    }
  }

  private acquireLock(): void {
    try {
      const pid = Number(fs.readFileSync(this.lock, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid < 1)
        throw new SalesError('Lock comercial inválido; inspecionar o diretório de dados');
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
        else throw error;
      }
      if (alive) throw new SalesError('O diretório comercial já está em utilização');
      fs.unlinkSync(this.lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    fs.writeFileSync(this.lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private event(
    action: string,
    detail: string,
    employeeId: EmployeeId | null = null,
    taskId: string | null = null,
  ): void {
    this.db
      .prepare('INSERT INTO events(at, employeeId, taskId, action, detail) VALUES (?,?,?,?,?)')
      .run(now(), employeeId, taskId, action, detail);
  }
  private changed(): void {
    this.emit('changed');
  }
  get suspended(): boolean {
    return (
      (this.db.prepare("SELECT value FROM settings WHERE key='suspended'").get() as Row).value ===
      '1'
    );
  }
  private task(row: Row): SalesTask {
    return {
      ...row,
      input: JSON.parse(row.input as string),
      result: row.result ? JSON.parse(row.result as string) : null,
    } as unknown as SalesTask;
  }
  getTask(id: string): SalesTask {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    if (!row) throw new SalesError('Tarefa inexistente', 404);
    return this.task(row);
  }
  snapshot(): SalesSnapshot {
    const tasks = this.db
      .prepare('SELECT * FROM tasks ORDER BY createdAt DESC, rowid DESC LIMIT 200')
      .all()
      .map((row) => this.task(row));
    const employees = EMPLOYEES.map((definition, index): SalesEmployee => {
      const enabled =
        (this.db.prepare('SELECT enabled FROM employees WHERE id=?').get(definition.id) as Row)
          .enabled === 1;
      const counts = Object.fromEntries(
        this.db
          .prepare('SELECT status, count(*) as n FROM tasks WHERE employeeId=? GROUP BY status')
          .all(definition.id)
          .map((row) => [row.status, Number(row.n)]),
      );
      const current = this.db
        .prepare("SELECT id FROM tasks WHERE employeeId=? AND status='running' LIMIT 1")
        .get(definition.id);
      return {
        ...definition,
        enabled,
        characterId: salesCharacterId(index),
        seatId: `agexa-${definition.id}-chair`,
        status: current
          ? 'working'
          : !enabled || this.suspended
            ? 'paused'
            : counts.awaiting_approval
              ? 'awaiting_approval'
              : counts.blocked
                ? 'blocked'
                : counts.error
                  ? 'error'
                  : 'available',
        currentTask: current ? String(current.id) : null,
        completed: counts.completed ?? 0,
        errors: counts.error ?? 0,
        queued: counts.queued ?? 0,
      };
    });
    return {
      version: 1,
      suspended: this.suspended,
      inference: {
        connected: this.inference.connected,
        provider: this.inference.name,
        message: this.inference.connected
          ? 'Fornecedor ligado'
          : 'Configurados, sem inferência real. Ollama depende da Fase 3.',
      },
      employees,
      tasks,
      events: this.db
        .prepare('SELECT * FROM events ORDER BY id DESC LIMIT 100')
        .all() as unknown as SalesSnapshot['events'],
      objective: SALES_OBJECTIVE,
    };
  }

  create(input: CreateSalesTask): SalesTask {
    this.validate(input);
    const task = this.transaction(() => this.insert(input));
    this.changed();
    return task;
  }
  private validate(input: CreateSalesTask): void {
    if (!EMPLOYEES.some((e) => e.id === input.employeeId))
      throw new SalesError('Funcionário inválido', 400);
    if (!['prepare_brief', 'qualify_company', 'sales_report', 'ai_request'].includes(input.kind))
      throw new SalesError('Operação não permitida', 400);
    if (input.kind === 'qualify_company' && input.employeeId !== 'atlas')
      throw new SalesError('Qualificação pertence ao Atlas', 400);
    if (input.kind === 'sales_report' && input.employeeId !== 'orion')
      throw new SalesError('Relatórios pertencem ao Orion', 400);
    if (!input.objective?.trim() || input.objective.length > 2000)
      throw new SalesError('Objetivo deve conter 1–2000 caracteres', 400);
    if (
      !input.input ||
      Array.isArray(input.input) ||
      typeof input.input !== 'object' ||
      JSON.stringify(input.input).length > 12000
    )
      throw new SalesError('Contexto inválido ou demasiado extenso', 400);
    if (input.input.authorized !== true)
      throw new SalesError('É necessário confirmar que os dados fornecidos são autorizados', 400);
    if (
      input.priority !== undefined &&
      (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 10)
    )
      throw new SalesError('Prioridade inválida', 400);
  }
  private insert(input: CreateSalesTask, parentId: string | null = null): SalesTask {
    const id = randomUUID();
    const status = input.requiresApproval
      ? 'awaiting_approval'
      : input.kind === 'ai_request' && !this.inference.connected
        ? 'blocked'
        : 'queued';
    this.db
      .prepare(
        'INSERT INTO tasks(id,employeeId,kind,objective,input,status,priority,createdAt,parentId) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        input.employeeId,
        input.kind,
        input.objective.trim(),
        JSON.stringify(input.input),
        status,
        input.priority ?? 5,
        now(),
        parentId,
      );
    this.event('task_created', `${status}: ${input.objective.trim()}`, input.employeeId, id);
    return this.getTask(id);
  }
  setEmployee(id: EmployeeId, enabled: boolean): void {
    if (!EMPLOYEES.some((e) => e.id === id)) throw new SalesError('Funcionário inexistente', 404);
    this.transaction(() => {
      this.db.prepare('UPDATE employees SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id);
      this.event(
        enabled ? 'employee_started' : 'employee_paused',
        enabled ? 'Fila habilitada; sem inferência implícita' : 'Execução pausada',
        id,
      );
      if (!enabled) this.interrupt(id);
    });
    this.changed();
  }
  suspend(value: boolean): void {
    this.transaction(() => {
      this.db.prepare("UPDATE settings SET value=? WHERE key='suspended'").run(value ? '1' : '0');
      this.event(
        value ? 'operations_suspended' : 'operations_resumed',
        value ? 'Suspensão global pelo CEO' : 'Operações retomadas pelo CEO',
      );
      if (value) for (const employee of EMPLOYEES) this.interrupt(employee.id);
    });
    this.changed();
  }
  private interrupt(employeeId: EmployeeId): void {
    const rows = this.db
      .prepare("SELECT id FROM tasks WHERE employeeId=? AND status='running'")
      .all(employeeId);
    for (const row of rows) {
      this.active.get(String(row.id))?.abort();
      this.db
        .prepare(
          "UPDATE tasks SET status='cancelled', finishedAt=?, error='Interrompida pelo CEO' WHERE id=?",
        )
        .run(now(), String(row.id));
      this.event(
        'task_cancelled',
        'Interrompida pelo CEO; resultado tardio será descartado',
        employeeId,
        String(row.id),
      );
    }
  }
  approve(id: string): void {
    this.transaction(() => {
      const task = this.getTask(id);
      if (task.status !== 'awaiting_approval')
        throw new SalesError('A tarefa não aguarda aprovação');
      const status = task.kind === 'ai_request' && !this.inference.connected ? 'blocked' : 'queued';
      this.db.prepare('UPDATE tasks SET status=?, approvedAt=? WHERE id=?').run(status, now(), id);
      this.event('task_approved', 'Aprovação do CEO', task.employeeId, id);
    });
    this.changed();
  }
  cancel(id: string): void {
    this.transaction(() => {
      const task = this.getTask(id);
      if (['completed', 'error', 'cancelled'].includes(task.status))
        throw new SalesError('Tarefa já terminou');
      this.active.get(id)?.abort();
      this.db
        .prepare("UPDATE tasks SET status='cancelled', finishedAt=? WHERE id=?")
        .run(now(), id);
      this.event('task_cancelled', 'Cancelada pelo CEO', task.employeeId, id);
    });
    this.changed();
  }
  transfer(id: string, recipient: EmployeeId): SalesTask {
    const result = this.transaction(() => {
      const source = this.getTask(id);
      if (source.status !== 'completed' || !source.result)
        throw new SalesError('Só resultados concluídos podem ser transferidos');
      if (source.employeeId === recipient)
        throw new SalesError('Selecionar outro funcionário', 400);
      const existing = this.db
        .prepare('SELECT * FROM tasks WHERE parentId=? AND employeeId=?')
        .get(id, recipient);
      if (existing) return this.task(existing);
      const input: CreateSalesTask = {
        employeeId: recipient,
        kind: 'prepare_brief',
        objective: `Continuar: ${source.objective}`.slice(0, 2000),
        input: { authorized: true, upstreamTaskId: id, upstreamResult: source.result },
      };
      this.validate(input);
      const next = this.insert(input, id);
      this.event('result_transferred', `Resultado entregue a ${recipient}`, source.employeeId, id);
      return next;
    });
    this.changed();
    return result;
  }

  startWorker(): void {
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.tick();
      }, 250);
      this.timer.unref();
    }
  }
  async tick(): Promise<void> {
    if (this.closed || this.busy || this.suspended) return;
    this.busy = true;
    try {
      while (!this.closed && !this.suspended && this.active.size < 2) {
        const claimed = this.transaction(() => {
          const row = this.db
            .prepare(
              `SELECT t.* FROM tasks t JOIN employees e ON e.id=t.employeeId
            WHERE t.status='queued' AND e.enabled=1
              AND NOT EXISTS (SELECT 1 FROM tasks r WHERE r.employeeId=t.employeeId AND r.status='running')
            ORDER BY t.priority DESC, t.createdAt, t.rowid LIMIT 1`,
            )
            .get();
          if (!row) return null;
          const task = this.task(row);
          this.db
            .prepare("UPDATE tasks SET status='running', startedAt=?, error=NULL WHERE id=?")
            .run(now(), task.id);
          this.event('task_started', task.objective, task.employeeId, task.id);
          return this.getTask(task.id);
        });
        if (!claimed) break;
        const controller = new AbortController();
        this.active.set(claimed.id, controller);
        this.changed();
        void this.execute(claimed, controller.signal);
      }
    } finally {
      this.busy = false;
    }
  }
  private async execute(task: SalesTask, signal: AbortSignal): Promise<void> {
    try {
      const result =
        task.kind === 'ai_request'
          ? await this.inference.run(task, { signal, objective: SALES_OBJECTIVE })
          : this.structuredOperation(task);
      if (!signal.aborted && !this.closed) this.finish(task, result, null);
    } catch (error) {
      if (!signal.aborted && !this.closed)
        this.finish(
          task,
          null,
          error instanceof Error ? error.message.slice(0, 2000) : 'Erro de execução',
        );
    } finally {
      this.active.delete(task.id);
    }
  }
  private finish(
    task: SalesTask,
    result: Record<string, unknown> | null,
    error: string | null,
  ): void {
    this.transaction(() => {
      if (this.getTask(task.id).status !== 'running') return;
      this.db
        .prepare('UPDATE tasks SET status=?, result=?, error=?, finishedAt=? WHERE id=?')
        .run(
          error ? 'error' : 'completed',
          result ? JSON.stringify(result) : null,
          error,
          now(),
          task.id,
        );
      this.event(
        error ? 'task_error' : 'task_completed',
        error ?? 'Resultado estruturado disponível',
        task.employeeId,
        task.id,
      );
    });
    this.changed();
  }
  private structuredOperation(task: SalesTask): Record<string, unknown> {
    if (task.kind === 'qualify_company') {
      if (!text(task.input.company).trim() || !text(task.input.source).trim())
        throw new Error('Informar empresa e fonte autorizada para qualificação');
      const criteria = [
        {
          criterion: 'Negócio depende de marcações',
          score: task.input.usesAppointments === true ? 40 : 0,
        },
        {
          criterion: 'Necessidade de organização confirmada',
          score: task.input.organizationNeed === true ? 30 : 0,
        },
        {
          criterion: 'Localização em Moçambique confirmada',
          score: task.input.inMozambique === true ? 20 : 0,
        },
        {
          criterion: 'Contacto comercial autorizado',
          score: task.input.contactConsent === true ? 10 : 0,
        },
      ];
      return {
        mode: 'rules',
        inference: false,
        company: task.input.company,
        source: task.input.source,
        criteria,
        score: criteria.reduce((sum, c) => sum + c.score, 0),
        contactPermitted: task.input.contactConsent === true,
        caveat: 'Classificação baseada apenas nos dados fornecidos pelo CEO; sem pesquisa externa.',
      };
    }
    if (task.kind === 'sales_report') {
      return {
        mode: 'database_report',
        inference: false,
        generatedAt: now(),
        completedTasks: Number(
          (this.db.prepare("SELECT count(*) as n FROM tasks WHERE status='completed'").get() as Row)
            .n,
        ),
        failedTasks: Number(
          (this.db.prepare("SELECT count(*) as n FROM tasks WHERE status='error'").get() as Row).n,
        ),
        registrations: null,
        payingCustomers: null,
        revenue: null,
        caveat: 'Conversões e receita não estão integradas; desconhecido não significa zero.',
      };
    }
    const employee = EMPLOYEES.find((e) => e.id === task.employeeId)!;
    return {
      mode: 'structured_brief',
      inference: false,
      employee: employee.name,
      role: employee.role,
      objective: task.objective,
      authorizedContext: task.input,
      salesObjective: SALES_OBJECTIVE,
      checklist: [
        'Usar apenas informação verificada e fontes autorizadas',
        'Obter consentimento antes de qualquer contacto',
        'Não marcar demonstrações',
        'Confirmar oferta e URL antes de mencionar 7 dias grátis',
        'Após envio confirmado do link, entregar ao CEO',
      ],
      nextStep:
        'Briefing organizado para revisão humana ou inferência da Fase 3; nenhuma pesquisa, mensagem ou venda foi executada.',
    };
  }
  close(): void {
    if (this.closed) return;
    if (this.timer) clearInterval(this.timer);
    this.transaction(() => {
      for (const e of EMPLOYEES) this.interrupt(e.id);
    });
    this.closed = true;
    this.db.close();
    fs.rmSync(this.lock, { force: true });
    this.removeAllListeners();
  }
}
