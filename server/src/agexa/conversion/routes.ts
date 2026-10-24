import * as fs from 'node:fs';

import type { FastifyInstance } from 'fastify';

import type { EmployeeId } from '../../../../core/src/agexa.js';
import type { ConversionConfig, ConversionFact } from '../../../../core/src/conversion.js';
import type { SalesEngine } from '../engine.js';
const str = (maxLength = 2000) => ({ type: 'string', maxLength });
const body = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  schema: { body: { type: 'object', additionalProperties: false, properties, required } },
});
const fact = {
  type: 'object',
  additionalProperties: false,
  required: ['eventId', 'appId', 'kind', 'occurredAt', 'accountId', 'evidence'],
  properties: {
    eventId: str(200),
    appId: str(200),
    kind: {
      enum: [
        'account_created',
        'trial_started',
        'trial_extended',
        'trial_ended',
        'trial_cancelled',
        'payment_confirmed',
      ],
    },
    occurredAt: str(40),
    accountId: str(200),
    reference: str(200),
    startAt: str(40),
    endAt: str(40),
    paymentId: str(200),
    amountMinor: { type: 'integer', minimum: 1 },
    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
    verified: { type: 'boolean' },
    evidence: str(1000),
  },
};
export function registerConversionRoutes(api: FastifyInstance, engine: SalesEngine): void {
  const c = engine.conversion;
  api.get('/conversion', async () => c.snapshot());
  api.post<{ Body: ConversionConfig }>(
    '/conversion/config',
    body({
      appId: str(200),
      endpoint: { type: ['string', 'null'], maxLength: 1000 },
      syncMode: { enum: ['manual', 'on_demand'] },
      authType: { const: 'hmac-sha256' },
      referenceSupported: { type: 'boolean' },
      referenceParameter: { type: 'string', maxLength: 31 },
      permissionEvidence: str(),
      retentionDays: { type: 'integer', minimum: 30, maximum: 3650 },
    }),
    async (req) => {
      c.configure(req.body);
      return { saved: true };
    },
  );
  api.get<{ Querystring: { status?: string; page?: number } }>(
    '/conversion/events',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { enum: ['', 'pending', 'applied', 'rejected'] },
            page: { type: 'integer', minimum: 1, maximum: 100000 },
          },
        },
      },
    },
    async (req) => c.store.events(req.query.status, req.query.page),
  );
  api.post<{ Body: { companyId: string; fact: ConversionFact; confirmed: boolean } }>(
    '/conversion/manual',
    body({ companyId: str(50), fact, confirmed: { const: true } }),
    async (req, reply) => reply.code(201).send(c.manual(req.body.companyId, req.body.fact)),
  );
  api.post('/conversion/sync', async () => c.sync());
  api.post<{
    Params: { id: string };
    Body: { companyId: string; evidence: string; allowAlias: boolean; confirmed: boolean };
  }>(
    '/conversion/events/:id/resolve',
    body({
      companyId: str(50),
      evidence: str(1000),
      allowAlias: { type: 'boolean' },
      confirmed: { const: true },
    }),
    async (req) => {
      c.resolve(req.params.id, req.body.companyId, req.body.evidence, req.body.allowAlias);
      return { saved: true };
    },
  );
  api.post<{ Params: { id: string }; Body: { evidence: string } }>(
    '/conversion/events/:id/reject',
    body({ evidence: str(1000) }),
    async (req) => {
      c.rejectEvent(req.params.id, req.body.evidence);
      return { recorded: true };
    },
  );
  api.get<{ Params: { id: string } }>('/conversion/handoffs/:id', async (req) =>
    c.handoffDetail(req.params.id),
  );
  api.post<{
    Params: { id: string };
    Body: { notes: string; followupAt: string | null; closedReason: string | null };
  }>(
    '/conversion/handoffs/:id',
    body({
      notes: str(4000),
      followupAt: { type: ['string', 'null'], maxLength: 40 },
      closedReason: { type: ['string', 'null'], maxLength: 1000 },
    }),
    async (req) => {
      c.followup(req.params.id, req.body.notes, req.body.followupAt, req.body.closedReason);
      return { saved: true };
    },
  );
  api.post<{ Body: { messageId: string; evidence: string } }>(
    '/conversion/objections',
    body({ messageId: str(50), evidence: str(1000) }),
    async (req) => {
      c.objection(req.body.messageId, req.body.evidence);
      return { saved: true };
    },
  );
  api.post<{ Params: { id: string } }>('/conversion/notices/:id/seen', async (req) => {
    c.noticeSeen(req.params.id);
    return { saved: true };
  });
  api.post('/conversion/trial-alerts', async () => {
    c.store.alertTrials();
    engine.notifyCrm();
    return { recorded: true };
  });
  api.post('/conversion/retention', async () => ({ redacted: c.store.prune() }));
  api.get('/conversion/audit', async () =>
    c.store.db.prepare('SELECT * FROM conversion_audit ORDER BY id DESC LIMIT 100').all(),
  );
  api.post<{ Body: { employeeId: EmployeeId; useAI: boolean } }>(
    '/conversion/review',
    body({ employeeId: { enum: ['nexus', 'sophia', 'orion'] }, useAI: { type: 'boolean' } }),
    async (req, reply) =>
      reply.code(201).send(engine.conversionReview(req.body.employeeId, req.body.useAI)),
  );
  api.post('/conversion/validation/inference', async (_req, reply) =>
    reply.code(201).send(engine.validateInference()),
  );
  api.get('/conversion/validation/readiness', async () => {
    const s = engine.snapshot();
    const m = s.messaging!.connection;
    return {
      ollama: s.intelligence?.status ?? { connected: false, models: [] },
      chromiumBinaryPresent:
        !!process.env.AGEXA_WHATSAPP_CHROMIUM_PATH &&
        fs.existsSync(process.env.AGEXA_WHATSAPP_CHROMIUM_PATH),
      messaging: {
        provider: m.provider,
        state: m.status,
        simulated: m.simulated,
        qrAvailable: m.qrAvailable,
        accountReported: !!m.account,
      },
      notice:
        'Binário presente não comprova sandbox, QR digitalizado, conta autenticada ou entrega real. Ver checklist técnica.',
    };
  });
}
