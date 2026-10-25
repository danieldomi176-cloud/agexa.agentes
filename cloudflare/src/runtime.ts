import { EMPLOYEES, type SalesTask } from '../../core/src/agexa.js';
import type { AgexaKnowledge } from '../../core/src/intelligence.js';
import { systemInstructions, validateOperationalResult } from '../../server/src/agexa/prompts.js';
export interface Statement {
  bind(...args: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface DB {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
}
export interface Env {
  DB: DB;
  AI: { run(model: string, input: unknown): Promise<unknown> };
  AI_MODEL?: string;
  FREE_ACCOUNT_CONFIRMED?: string;
  FREE_MODEL_CONFIRMED?: string;
  DAILY_CALLS?: string;
  AUTONOMY_ENABLED?: string;
}
const timestamp = () => new Date().toISOString();
export async function cycle(env: Env): Promise<string> {
  if (env.AUTONOMY_ENABLED !== 'true') return 'disabled';
  const control = await env.DB.prepare("SELECT * FROM cf_control WHERE id='main'").first();
  if (
    !control ||
    control.paused ||
    !env.AI_MODEL ||
    env.FREE_ACCOUNT_CONFIRMED !== 'true' ||
    env.FREE_MODEL_CONFIRMED !== 'true'
  )
    return 'paused_or_unconfigured';
  const original = await env.DB.prepare("SELECT value FROM settings WHERE key='suspended'").first();
  if (original?.value === '1') return 'original_suspension';
  const token = crypto.randomUUID(),
    now = Date.now();
  const lock = await env.DB.prepare(
    "UPDATE cf_lease SET token=?,expires=? WHERE id='scheduler' AND expires<?",
  )
    .bind(token, now + 120000, now)
    .run();
  if (lock.meta.changes !== 1) return 'busy';
  try {
    // An expired inference has an uncertain provider outcome. Never replay it automatically.
    await env.DB.prepare(
      "UPDATE tasks SET status='blocked',error='Inferência interrompida; rever quota e resultado antes de criar nova tarefa' WHERE status='running' AND id IN (SELECT taskId FROM cf_jobs)",
    ).run();
    const row = await env.DB.prepare(
      "SELECT t.*,j.mode,j.companyId,j.nextId FROM tasks t JOIN cf_jobs j ON j.taskId=t.id JOIN employees e ON e.id=t.employeeId WHERE t.status='queued' AND t.approvedAt IS NOT NULL AND e.enabled=1 AND j.readyAt<=? ORDER BY t.priority DESC,t.createdAt,t.rowid LIMIT 1",
    )
      .bind(now)
      .first();
    if (!row) return 'idle';
    const permission = await env.DB.prepare(
      'SELECT s.id FROM crm_companies c JOIN crm_sources s ON s.id=c.sourceId WHERE c.id=? AND s.enabled=1 AND s.termsReviewed=1 AND s.commercialReuseAllowed=1',
    )
      .bind(row.companyId)
      .first();
    if (!permission) {
      await env.DB.prepare(
        "UPDATE tasks SET status='blocked',error='Permissão atual da fonte indisponível' WHERE id=?",
      )
        .bind(row.id)
        .run();
      return 'source_blocked';
    }

    if (row.employeeId === 'hunter' && row.mode === 'research') {
      await env.DB.prepare(
        "UPDATE tasks SET status='blocked',error='Pesquisa bloqueada: sem ferramenta de pesquisa autorizada' WHERE id=?",
      )
        .bind(row.id)
        .run();
      return 'research_blocked';
    }
    const limit = Math.max(1, Math.min(10, Number(env.DAILY_CALLS) || 5)),
      day = new Date().toISOString().slice(0, 10);
    const reserve = await env.DB.prepare(
      'INSERT INTO cf_budget(day,attempts) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET attempts=attempts+1 WHERE attempts<?',
    )
      .bind(day, limit)
      .run();
    if (reserve.meta.changes !== 1) return 'quota';
    await env.DB.batch([
      env.DB.prepare("UPDATE tasks SET status='running',startedAt=?,model=? WHERE id=?").bind(
        timestamp(),
        env.AI_MODEL,
        row.id,
      ),
      env.DB.prepare('UPDATE cf_jobs SET token=?,epoch=? WHERE taskId=?').bind(
        token,
        control.epoch,
        row.id,
      ),
      env.DB.prepare(
        'INSERT INTO events(at,employeeId,taskId,action,detail) VALUES (?,?,?,?,?)',
      ).bind(
        timestamp(),
        row.employeeId,
        row.id,
        'cf_inference_started',
        'Tentativa real reservada; não comprova resultado',
      ),
    ]);
    try {
      const task = {
        ...row,
        input: JSON.parse(String(row.input)),
        stage: 'work',
      } as unknown as SalesTask;
      const knowledgeRow = await env.DB.prepare(
        "SELECT value FROM settings WHERE key='knowledge'",
      ).first();
      // Safe default; commercial claims remain disabled without the original confirmed knowledge.
      const knowledge: AgexaKnowledge = knowledgeRow
        ? JSON.parse(String(knowledgeRow.value))
        : {
            signupUrl: null,
            trialAvailable: false,
            trialDays: 7,
            confirmedFeatures: [],
            approvedPrices: [],
            policies: [],
          };
      const system = systemInstructions(task, knowledge);
      if (row.employeeId === 'orion')
        task.input.databaseMetrics = {
          companies: await env.DB.prepare('SELECT count(*) count FROM crm_companies').first(),
          tasks: (
            await env.DB.prepare('SELECT status,count(*) count FROM tasks GROUP BY status').all()
          ).results,
          conversions: (
            await env.DB.prepare(
              'SELECT origin,status,count(*) count FROM conversion_events GROUP BY origin,status',
            ).all()
          ).results,
        };
      const context = JSON.stringify(task.input);
      if (new TextEncoder().encode(system + context).length > 12000)
        throw Error('Contexto excede limite');
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let answer: unknown;
      try {
        answer = await Promise.race([
          env.AI.run(env.AI_MODEL, {
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: context },
            ],
            max_tokens: 256,
          }),
          new Promise<never>(
            (_, reject) =>
              (timeout = setTimeout(
                () => reject(Error('Inferência com resultado incerto')),
                45000,
              )),
          ),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      const text = (answer as { response?: unknown })?.response;
      if (typeof text !== 'string' || text.length > 16000)
        throw Error('Contrato de resposta inválido');
      const result = validateOperationalResult(JSON.parse(text), task, knowledge);
      const guard =
        "EXISTS(SELECT 1 FROM cf_control c,cf_lease l WHERE c.id='main' AND c.paused=0 AND c.epoch=? AND l.id='scheduler' AND l.token=? AND l.expires>?)";
      const args = [control.epoch, token, Date.now()];
      const statements = [
        env.DB.prepare(
          `UPDATE tasks SET status='completed',result=?,finishedAt=?,durationMs=? WHERE id=? AND ${guard}`,
        ).bind(JSON.stringify(result), timestamp(), Date.now() - now, row.id, ...args),
        env.DB.prepare(
          `INSERT INTO memories(employeeId,taskId,kind,content,createdAt) SELECT ?,?,'cf_result',?,? WHERE ${guard}`,
        ).bind(row.employeeId, row.id, JSON.stringify(result), timestamp(), ...args),
        env.DB.prepare(
          `INSERT INTO events(at,employeeId,taskId,action,detail) SELECT ?,?,?,'cf_inference_completed','Resultado Workers AI validado; rascunho interno' WHERE ${guard}`,
        ).bind(timestamp(), row.employeeId, row.id, ...args),
      ];
      if (row.companyId)
        statements.push(
          env.DB.prepare(
            `UPDATE crm_companies SET nextAction=?,updatedAt=? WHERE id=? AND ${guard}`,
          ).bind(
            'Rever rascunho interno ' + row.employeeId + ' / ' + row.id,
            timestamp(),
            row.companyId,
            ...args,
          ),
        );
      if (row.nextId)
        statements.push(
          env.DB.prepare(`UPDATE tasks SET status='queued',input=? WHERE id=? AND ${guard}`).bind(
            JSON.stringify({ ...task.input, previousResult: result }),
            row.nextId,
            ...args,
          ),
        );
      await env.DB.batch(statements);
      const saved = await env.DB.prepare('SELECT status FROM tasks WHERE id=?')
        .bind(row.id)
        .first();
      if (saved?.status !== 'completed') {
        await env.DB.prepare(
          "UPDATE tasks SET status='blocked',error='Resultado descartado após pausa ou lease expirado' WHERE id=? AND status='running'",
        )
          .bind(row.id)
          .run();
        return 'discarded';
      }
      return 'completed';
    } catch {
      await env.DB.prepare(
        "UPDATE tasks SET status='blocked',error='Falha, quota externa ou resultado IA incerto/inválido; tentativa consumida, sem repetição automática' WHERE id=? AND status='running'",
      )
        .bind(row.id)
        .run();
      return 'blocked';
    }
  } finally {
    await env.DB.prepare(
      "UPDATE cf_lease SET expires=0,token=NULL WHERE id='scheduler' AND token=?",
    )
      .bind(token)
      .run();
  }
}
export async function control(env: Env, action: 'pause' | 'resume' | 'stop'): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("UPDATE settings SET value=? WHERE key='suspended'").bind(
      action === 'resume' ? '0' : '1',
    ),
    env.DB.prepare("UPDATE cf_control SET paused=?,epoch=epoch+1 WHERE id='main'").bind(
      action === 'resume' ? 0 : 1,
    ),
    env.DB.prepare('INSERT INTO events(at,action,detail) VALUES (?,?,?)').bind(
      timestamp(),
      'cf_' + action,
      'Ação autenticada do CEO',
    ),
    ...(action === 'stop'
      ? [
          env.DB.prepare(
            "UPDATE tasks SET status='cancelled',finishedAt=? WHERE id IN (SELECT taskId FROM cf_jobs) AND status IN ('queued','blocked','running')",
          ).bind(timestamp()),
        ]
      : []),
  ]);
}
export async function enqueue(
  env: Env,
  id: string,
  companyId: string,
  objective: string,
  mode: 'research' | 'provided',
  readyAt: number,
): Promise<void> {
  if (
    !/^[a-f0-9-]{36}$/.test(id) ||
    !objective.trim() ||
    objective.length > 1000 ||
    !Number.isSafeInteger(readyAt) ||
    readyAt < Date.now() - 60000
  )
    throw Error('Ordem inválida');
  const company = await env.DB.prepare(
    'SELECT c.id,c.name,c.sector,c.city,c.needs,c.website,c.businessPage,s.permissionEvidence FROM crm_companies c JOIN crm_sources s ON s.id=c.sourceId WHERE c.id=?',
  )
    .bind(companyId)
    .first();
  if (!company || !company.permissionEvidence || !(company.website || company.businessPage))
    throw Error('Empresa existente com fonte/evidência necessária');
  const order = ['nexus', 'hunter', 'atlas', 'maya', 'luna', 'victor', 'sophia', 'orion'];
  const ids = order.map((_, i) => id + '-' + i),
    stmts: Statement[] = [];
  // A fixed, CEO-approved internal chain; no model-created tools or recursive jobs.
  stmts.push(env.DB.prepare('INSERT INTO cf_requests VALUES (?,?)').bind(id, Date.now()));
  order.forEach((agent, i) => {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO tasks(id,employeeId,kind,objective,input,status,priority,createdAt,parentId,approvedAt,stage,dependencyIds) VALUES (?,?,'ai_request',?,?,?,1,?,?,?,'work',?)",
      ).bind(
        ids[i],
        agent,
        objective,
        JSON.stringify({
          authorized: true,
          companyId,
          source: company,
          metrics:
            agent === 'orion'
              ? 'Consultar apenas factos do contexto; desconhecidos permanecem desconhecidos'
              : undefined,
        }),
        i === 0 ? 'queued' : 'blocked',
        timestamp(),
        i ? ids[i - 1] : null,
        timestamp(),
        JSON.stringify(i ? [ids[i - 1]] : []),
      ),
    );
    stmts.push(
      env.DB.prepare(
        'INSERT INTO cf_jobs(taskId,nextId,companyId,readyAt,mode) VALUES (?,?,?,?,?)',
      ).bind(ids[i], ids[i + 1] ?? null, companyId, readyAt, mode),
    );
  });
  await env.DB.batch(stmts);
}
export async function snapshot(env: Env) {
  const state = await env.DB.prepare("SELECT * FROM cf_control WHERE id='main'").first();
  const employees = await env.DB.prepare('SELECT * FROM employees').all();
  return {
    state,
    employees: EMPLOYEES.map((e) => ({
      ...e,
      enabled: employees.results.find((r) => r.id === e.id)?.enabled === 1,
    })),
    tasks: (
      await env.DB.prepare(
        'SELECT id,employeeId,status,objective,result,error FROM tasks ORDER BY rowid DESC LIMIT 100',
      ).all()
    ).results,
    budget: (await env.DB.prepare('SELECT * FROM cf_budget ORDER BY day DESC LIMIT 3').all())
      .results,
    events: (await env.DB.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 100').all()).results,
  };
}
