import type { FastifyInstance } from 'fastify';

import type { EmployeeId } from '../../../../core/src/agexa.js';
import type {
  ChannelMode,
  MessagingConversation,
  MessagingDraft,
  MessagingProviderId,
} from '../../../../core/src/messaging.js';
import { CrmError } from '../crm/error.js';
import type { SalesEngine } from '../engine.js';
import { MockWhatsAppProvider } from './mock.js';
const str = (maxLength = 1000) => ({ type: 'string', maxLength, minLength: 1 });
const body = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  schema: { body: { type: 'object', additionalProperties: false, properties, required } },
});
export function registerMessagingRoutes(api: FastifyInstance, engine: SalesEngine): void {
  const m = engine.messaging;
  api.get('/messaging', async () => m.snapshot());
  api.get('/messaging/qr', async (_request, reply) =>
    reply.header('Cache-Control', 'no-store, private').send(await m.qrImage()),
  );
  api.post<{ Body: { provider: MessagingProviderId; confirmedExperimental: boolean } }>(
    '/messaging/config',
    body({
      provider: { enum: ['none', 'mock', 'web_experimental', 'cloud_api'] },
      confirmedExperimental: { type: 'boolean' },
    }),
    async (req) => {
      await m.configure(req.body.provider, req.body.confirmedExperimental);
      return { saved: true };
    },
  );
  api.post<{
    Body: { action: 'connect' | 'disconnect' | 'revoke'; confirmedExperimental: boolean };
  }>(
    '/messaging/connection',
    body({
      action: { enum: ['connect', 'disconnect', 'revoke'] },
      confirmedExperimental: { type: 'boolean' },
    }),
    async (req) => {
      if (req.body.action === 'connect') await m.connect(req.body.confirmedExperimental);
      else await m.disconnect(req.body.action === 'revoke');
      return { saved: true };
    },
  );
  api.post<{ Body: { mode: ChannelMode } }>(
    '/messaging/mode',
    body({ mode: { enum: ['manual', 'assisted', 'automatic'] } }),
    async (req) => {
      m.setMode(req.body.mode);
      return { saved: true };
    },
  );
  api.post<{ Body: { suspended: boolean } }>(
    '/messaging/suspension',
    body({ suspended: { type: 'boolean' } }),
    async (req) => {
      m.suspend(req.body.suspended);
      return { saved: true };
    },
  );
  api.post('/messaging/stop', async () => {
    engine.suspend(true);
    m.suspend(true);
    return { suspended: true };
  });
  api.get<{ Querystring: { search?: string; state?: string; page?: number } }>(
    '/messaging/conversations',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            search: { type: 'string', maxLength: 200 },
            state: { enum: ['', 'open', 'human', 'opted_out', 'reconciliation'] },
            page: { type: 'integer', minimum: 1, maximum: 100000 },
          },
        },
      },
    },
    async (req) =>
      m.store.list(
        m.snapshot().connection.provider,
        req.query.search,
        req.query.state,
        req.query.page,
      ),
  );
  api.get<{ Params: { id: string }; Querystring: { page?: number } }>(
    '/messaging/conversations/:id',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { page: { type: 'integer', minimum: 1, maximum: 100000 } },
        },
      },
    },
    async (req) => ({
      ...m.store.detail(req.params.id, req.query.page),
      deliveries: m.deliveries(req.params.id),
    }),
  );
  api.post<{ Params: { id: string }; Body: { companyId: string } }>(
    '/messaging/conversations/:id/company',
    body({ companyId: str(50) }),
    async (req) => {
      m.link(req.params.id, req.body.companyId);
      return { saved: true };
    },
  );
  api.post<{ Params: { id: string }; Body: { owner: MessagingConversation['owner'] } }>(
    '/messaging/conversations/:id/owner',
    body({
      owner: {
        enum: ['ceo', 'nexus', 'hunter', 'atlas', 'maya', 'luna', 'victor', 'sophia', 'orion'],
      },
    }),
    async (req) => {
      m.assign(req.params.id, req.body.owner);
      return { saved: true };
    },
  );
  api.post<{ Params: { id: string }; Body: { notes: string } }>(
    '/messaging/conversations/:id/notes',
    body({ notes: { type: 'string', maxLength: 4000 } }),
    async (req) => {
      m.note(req.params.id, req.body.notes);
      return { saved: true };
    },
  );
  api.post<{
    Params: { id: string };
    Body: {
      messageId: string;
      kind: 'interest' | 'link_acceptance';
      evidence: string;
      confirmed: boolean;
    };
  }>(
    '/messaging/conversations/:id/acceptance',
    body({
      messageId: str(50),
      kind: { enum: ['interest', 'link_acceptance'] },
      evidence: str(1000),
      confirmed: { const: true },
    }),
    async (req) => {
      m.acceptance(req.params.id, req.body.messageId, req.body.kind, req.body.evidence);
      return { saved: true };
    },
  );
  api.post<{ Params: { id: string }; Body: { body: string; kind: MessagingDraft['kind'] } }>(
    '/messaging/conversations/:id/drafts',
    body({ body: str(6000), kind: { enum: ['reply', 'invitation'] } }),
    async (req, reply) =>
      reply.code(201).send(m.draft(req.params.id, req.body.body, req.body.kind)),
  );
  api.post<{ Params: { id: string }; Body: { decision: 'approved' | 'rejected' } }>(
    '/messaging/drafts/:id/review',
    body({ decision: { enum: ['approved', 'rejected'] } }),
    async (req) => {
      m.review(req.params.id, req.body.decision);
      return { saved: true };
    },
  );
  api.post<{ Params: { id: string }; Body: { confirmed: boolean } }>(
    '/messaging/drafts/:id/send',
    body({ confirmed: { const: true } }),
    async (req) => {
      await m.send(req.params.id);
      return { recorded: true };
    },
  );
  api.post<{
    Params: { id: string };
    Body: { outcome: 'confirmed' | 'not_sent'; evidence: string };
  }>(
    '/messaging/deliveries/:id/reconcile',
    body({ outcome: { enum: ['confirmed', 'not_sent'] }, evidence: str(1000) }),
    async (req) => {
      m.reconcile(req.params.id, req.body.outcome, req.body.evidence);
      return { saved: true };
    },
  );
  api.post<{
    Params: { id: string };
    Body: { employeeId: EmployeeId; useAI: boolean; team: boolean };
  }>(
    '/messaging/conversations/:id/work',
    body({
      employeeId: {
        enum: ['nexus', 'hunter', 'atlas', 'maya', 'luna', 'victor', 'sophia', 'orion'],
      },
      useAI: { type: 'boolean' },
      team: { type: 'boolean' },
    }),
    async (req, reply) =>
      reply
        .code(201)
        .send(
          req.body.team
            ? engine.queueMessagingTeam(req.params.id, req.body.useAI)
            : engine.queueMessagingWork(req.params.id, req.body.employeeId, req.body.useAI),
        ),
  );
  // There is no production endpoint for injecting received messages or arbitrary numbers.
  if (process.env.AGEXA_MESSAGING_TEST_MODE === '1')
    api.post<{ Body: { id: string; remoteId: string; body: string } }>(
      '/messaging/test/inbound',
      body({ id: str(100), remoteId: str(30), body: str(6000) }),
      async (req) => {
        const p = m.activeProvider;
        if (!(p instanceof MockWhatsAppProvider))
          throw new CrmError('Provider de teste não está ligado');
        p.receive(req.body.id, req.body.remoteId, req.body.body);
        return { simulated: true };
      },
    );
}
