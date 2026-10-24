import type { FastifyInstance } from 'fastify';

import type { EmployeeId } from '../../../../core/src/agexa.js';
import type {
  BusinessChannel,
  BusinessSource,
  CommercialSettings,
  CompanyInput,
  PipelineStage,
  SalesDraft,
} from '../../../../core/src/crm.js';
import type { SalesEngine } from '../engine.js';

const companySchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    ...Object.fromEntries(
      [
        'sector',
        'city',
        'province',
        'country',
        'website',
        'businessPage',
        'businessContact',
        'needs',
        'nextAction',
      ].map((key) => [
        key,
        {
          type: 'string',
          maxLength:
            key === 'needs' ? 2000 : key === 'website' || key === 'businessPage' ? 1000 : 500,
        },
      ]),
    ),
    contactChannel: { enum: ['none', 'website', 'email', 'whatsapp', 'business_phone'] },
    ...Object.fromEntries(
      ['usesAppointments', 'organizationNeed', 'hasSchedulingSystem', 'sufficientInfo'].map(
        (key) => [key, { type: ['boolean', 'null'] }],
      ),
    ),
  },
};
export function registerCrmRoutes(api: FastifyInstance, engine: SalesEngine): void {
  api.get('/crm', async () => engine.crm.snapshot());
  api.get<{
    Querystring: { search?: string; sector?: string; city?: string; stage?: string; page?: number };
  }>(
    '/crm/companies',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            search: { type: 'string', maxLength: 200 },
            sector: { type: 'string', maxLength: 100 },
            city: { type: 'string', maxLength: 100 },
            stage: { type: 'string', maxLength: 30 },
            page: { type: 'integer', minimum: 1, maximum: 100000 },
          },
        },
      },
    },
    async (request) => engine.crm.list(request.query),
  );
  api.get<{ Params: { id: string } }>('/crm/companies/:id', async (request) =>
    engine.crm.detail(request.params.id),
  );
  api.get('/crm/export', async (_request, reply) =>
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="agexa-empresas.csv"')
      .send(engine.crm.exportCsv()),
  );
  api.post<{ Body: Omit<BusinessSource, 'id' | 'createdAt'> }>(
    '/crm/sources',
    {
      schema: {
        body: {
          type: 'object',
          required: [
            'name',
            'kind',
            'permissionEvidence',
            'attribution',
            'enabled',
            'termsReviewed',
            'commercialReuseAllowed',
          ],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            kind: { enum: ['manual', 'csv', 'website'] },
            url: { type: ['string', 'null'], maxLength: 1000 },
            termsUrl: { type: ['string', 'null'], maxLength: 1000 },
            permissionEvidence: { type: 'string', minLength: 1, maxLength: 2000 },
            attribution: { type: 'string', maxLength: 1000 },
            enabled: { type: 'boolean' },
            termsReviewed: { const: true },
            commercialReuseAllowed: { const: true },
          },
        },
      },
    },
    async (request, reply) => {
      const source = engine.crm.createSource({
        ...request.body,
        url: request.body.url ?? null,
        termsUrl: request.body.termsUrl ?? null,
      });
      engine.notifyCrm();
      return reply.code(201).send(source);
    },
  );
  api.post<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/crm/sources/:id',
    {
      schema: {
        body: {
          type: 'object',
          required: ['enabled'],
          properties: { enabled: { type: 'boolean' } },
        },
      },
    },
    async (request) => {
      engine.crm.setSource(request.params.id, request.body.enabled);
      engine.notifyCrm();
      return { saved: true };
    },
  );
  api.post<{
    Body: {
      sourceId: string;
      authorized: boolean;
      businessOnly: boolean;
      csv?: string;
      records?: CompanyInput[];
      company?: CompanyInput;
      simulated?: boolean;
    };
  }>(
    '/crm/import',
    {
      schema: {
        body: {
          type: 'object',
          required: ['sourceId', 'authorized', 'businessOnly'],
          additionalProperties: false,
          properties: {
            sourceId: { type: 'string', maxLength: 50 },
            authorized: { const: true },
            businessOnly: { const: true },
            csv: { type: 'string', maxLength: 48000 },
            records: { type: 'array', maxItems: 200, items: companySchema },
            company: companySchema,
            simulated: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) =>
      reply.code(201).send(engine.queueCrmImport(request.body.sourceId, request.body)),
  );
  api.patch<{ Params: { id: string }; Body: CompanyInput }>(
    '/crm/companies/:id',
    { schema: { body: companySchema } },
    async (request) => {
      const company = engine.crm.updateCompany(request.params.id, request.body);
      engine.notifyCrm();
      return company;
    },
  );
  api.post<{ Params: { id: string }; Body: { employeeId: EmployeeId } }>(
    '/crm/companies/:id/owner',
    {
      schema: {
        body: {
          type: 'object',
          required: ['employeeId'],
          properties: { employeeId: { type: 'string', maxLength: 20 } },
        },
      },
    },
    async (request) => {
      engine.crm.assignOwner(request.params.id, request.body.employeeId);
      engine.notifyCrm();
      return { saved: true };
    },
  );
  api.post<{
    Params: { id: string };
    Body: {
      channel: BusinessChannel;
      status: 'granted' | 'revoked' | 'denied';
      evidence: string;
      origin: string;
    };
  }>(
    '/crm/companies/:id/consent',
    {
      schema: {
        body: {
          type: 'object',
          required: ['channel', 'status', 'evidence', 'origin'],
          additionalProperties: false,
          properties: {
            channel: { enum: ['website', 'email', 'whatsapp', 'business_phone'] },
            status: { enum: ['granted', 'revoked', 'denied'] },
            evidence: { type: 'string', minLength: 1, maxLength: 2000 },
            origin: { type: 'string', minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    async (request) => {
      const b = request.body;
      engine.crm.consent(request.params.id, b.channel, b.status, b.evidence, b.origin);
      engine.notifyCrm();
      return engine.crm.company(request.params.id);
    },
  );
  api.post<{
    Params: { id: string };
    Body: {
      stage: PipelineStage;
      verification?: { independentlyVerified: boolean; evidence: string; occurredAt: string };
    };
  }>(
    '/crm/companies/:id/stage',
    {
      schema: {
        body: {
          type: 'object',
          required: ['stage'],
          additionalProperties: false,
          properties: {
            stage: { type: 'string', maxLength: 30 },
            verification: {
              type: 'object',
              required: ['independentlyVerified', 'evidence', 'occurredAt'],
              additionalProperties: false,
              properties: {
                independentlyVerified: { const: true },
                evidence: { type: 'string', minLength: 1, maxLength: 2000 },
                occurredAt: { type: 'string', maxLength: 40 },
              },
            },
          },
        },
      },
    },
    async (request) => {
      engine.moveCrm(request.params.id, request.body.stage, request.body.verification);
      return engine.crm.company(request.params.id);
    },
  );
  api.post<{
    Params: { id: string };
    Body: { employeeId: EmployeeId; useAI: boolean; objection?: string };
  }>(
    '/crm/companies/:id/work',
    {
      schema: {
        body: {
          type: 'object',
          required: ['employeeId', 'useAI'],
          additionalProperties: false,
          properties: {
            employeeId: { enum: ['atlas', 'maya', 'luna', 'victor', 'sophia'] },
            useAI: { type: 'boolean' },
            objection: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          engine.queueCrmWork(
            request.params.id,
            request.body.employeeId,
            request.body.useAI,
            request.body.objection,
          ),
        ),
  );
  api.post<{ Params: { id: string } }>('/crm/companies/:id/handoff', async (request) =>
    engine.prepareHandoff(request.params.id),
  );
  api.post<{
    Params: { id: string };
    Body: { employeeId: EmployeeId; kind: SalesDraft['kind']; body: string };
  }>(
    '/crm/companies/:id/drafts',
    {
      schema: {
        body: {
          type: 'object',
          required: ['employeeId', 'kind', 'body'],
          additionalProperties: false,
          properties: {
            employeeId: { enum: ['maya', 'luna', 'victor', 'sophia'] },
            kind: { enum: ['approach', 'simulation', 'objections', 'invitation'] },
            body: { type: 'string', minLength: 1, maxLength: 6000 },
          },
        },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          engine.saveManualDraft(
            request.params.id,
            request.body.employeeId,
            request.body.kind,
            request.body.body,
          ),
        ),
  );
  api.post<{ Params: { id: string }; Body: { status: 'approved' | 'rejected' } }>(
    '/crm/drafts/:id/review',
    {
      schema: {
        body: {
          type: 'object',
          required: ['status'],
          properties: { status: { enum: ['approved', 'rejected'] } },
        },
      },
    },
    async (request) => {
      engine.crm.reviewDraft(request.params.id, request.body.status);
      engine.notifyCrm();
      return { saved: true };
    },
  );
  api.post<{ Body: CommercialSettings }>(
    '/crm/settings',
    {
      schema: {
        body: {
          type: 'object',
          required: [
            'prioritySectors',
            'priorityCities',
            'qualificationThreshold',
            'maxImportRows',
            'maxResearchPerHour',
            'maxCampaignLeads',
            'contactPolicy',
          ],
          additionalProperties: false,
          properties: {
            prioritySectors: {
              type: 'array',
              maxItems: 30,
              items: { type: 'string', maxLength: 100 },
            },
            priorityCities: {
              type: 'array',
              maxItems: 30,
              items: { type: 'string', maxLength: 100 },
            },
            qualificationThreshold: { type: 'integer', minimum: 0, maximum: 100 },
            maxImportRows: { type: 'integer', minimum: 1, maximum: 200 },
            maxResearchPerHour: { type: 'integer', minimum: 1, maximum: 30 },
            maxCampaignLeads: { type: 'integer', minimum: 1, maximum: 3 },
            contactPolicy: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    async (request) => {
      engine.crm.saveSettings(request.body);
      engine.notifyCrm();
      return { saved: true };
    },
  );
  api.post<{
    Body: { goal: string; sourceId: string; sector: string; city: string; useAI: boolean };
  }>(
    '/crm/orders',
    {
      schema: {
        body: {
          type: 'object',
          required: ['goal', 'sourceId', 'sector', 'city', 'useAI'],
          additionalProperties: false,
          properties: {
            goal: { type: 'string', minLength: 1, maxLength: 2000 },
            sourceId: { type: 'string', maxLength: 50 },
            sector: { type: 'string', maxLength: 100 },
            city: { type: 'string', maxLength: 100 },
            useAI: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const b = request.body;
      return reply
        .code(201)
        .send(engine.createCommercialOrder(b.goal, b.sourceId, b.sector, b.city, b.useAI));
    },
  );
  api.post<{ Params: { id: string; action: string } }>(
    '/crm/orders/:id/:action',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id', 'action'],
          properties: {
            id: { type: 'string', maxLength: 50 },
            action: { enum: ['approve', 'cancel'] },
          },
        },
      },
    },
    async (request) => {
      if (request.params.action === 'approve') engine.approveCommercialOrder(request.params.id);
      else engine.cancelCommercialOrder(request.params.id);
      return { saved: true };
    },
  );
}
