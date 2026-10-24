import type { FastifyInstance } from 'fastify';

import type { EmployeeId } from '../../../core/src/agexa.js';
import type { AgexaKnowledge, IntelligenceConfig } from '../../../core/src/intelligence.js';
import { SalesEngine, SalesError } from './engine.js';
import { validateKnowledge } from './memory.js';
import { validateIntelligenceConfig } from './ollama.js';

// Called inside the existing authenticated commercial Fastify scope.
export function registerIntelligenceRoutes(api: FastifyInstance, engine: SalesEngine): void {
  api.post('/intelligence/probe', async () => {
    await engine.refreshIntelligence();
    return engine.snapshot();
  });
  api.post<{ Body: IntelligenceConfig }>(
    '/intelligence/config',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'baseUrl',
            'model',
            'timeoutMs',
            'maxContextChars',
            'concurrency',
            'maxTasks',
            'maxInferences',
          ],
          properties: {
            baseUrl: { type: 'string', maxLength: 200 },
            model: { type: 'string', maxLength: 120 },
            timeoutMs: { type: 'integer', minimum: 50, maximum: 180000 },
            maxContextChars: { type: 'integer', minimum: 2000, maximum: 24000 },
            concurrency: { type: 'integer', minimum: 1, maximum: 2 },
            maxTasks: { type: 'integer', minimum: 9, maximum: 30 },
            maxInferences: { type: 'integer', minimum: 9, maximum: 30 },
          },
        },
      },
    },
    async (request) => {
      try {
        validateIntelligenceConfig(request.body);
      } catch (error) {
        throw new SalesError(error instanceof Error ? error.message : 'Configuração inválida', 400);
      }
      engine.configureIntelligence(request.body);
      await engine.refreshIntelligence();
      return engine.snapshot();
    },
  );
  api.post<{ Body: AgexaKnowledge }>(
    '/knowledge',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'signupUrl',
            'trialAvailable',
            'trialDays',
            'confirmedFeatures',
            'approvedPrices',
            'policies',
          ],
          properties: {
            signupUrl: { type: ['string', 'null'], maxLength: 500 },
            trialAvailable: { type: 'boolean' },
            trialDays: { const: 7 },
            confirmedFeatures: {
              type: 'array',
              maxItems: 20,
              items: { type: 'string', minLength: 1, maxLength: 300 },
            },
            approvedPrices: {
              type: 'array',
              maxItems: 20,
              items: { type: 'string', minLength: 1, maxLength: 300 },
            },
            policies: {
              type: 'array',
              maxItems: 20,
              items: { type: 'string', minLength: 1, maxLength: 300 },
            },
          },
        },
      },
    },
    async (request) => {
      try {
        validateKnowledge(request.body);
      } catch (error) {
        throw new SalesError(error instanceof Error ? error.message : 'Conhecimento inválido', 400);
      }
      engine.saveKnowledge(request.body);
      return engine.snapshot();
    },
  );
  api.post<{ Body: { content: string; employeeId?: EmployeeId } }>(
    '/decisions',
    {
      schema: {
        body: {
          type: 'object',
          required: ['content'],
          additionalProperties: false,
          properties: {
            content: { type: 'string', minLength: 1, maxLength: 2000 },
            employeeId: { type: 'string', maxLength: 20 },
          },
        },
      },
    },
    async (request) => {
      engine.addDecision(request.body.content, request.body.employeeId ?? null);
      return engine.snapshot();
    },
  );
  api.post<{ Body: { goal: string; input: Record<string, unknown> } }>(
    '/commands',
    {
      schema: {
        body: {
          type: 'object',
          required: ['goal', 'input'],
          additionalProperties: false,
          properties: {
            goal: { type: 'string', minLength: 1, maxLength: 2000 },
            input: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) =>
      reply.code(201).send(engine.commandNexus(request.body.goal, request.body.input)),
  );
  api.post<{ Params: { id: string; action: string } }>(
    '/workflows/:id/:action',
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
      try {
        if (request.params.action === 'approve') engine.approveWorkflow(request.params.id);
        else engine.cancelWorkflow(request.params.id);
      } catch (error) {
        if (error instanceof Error && error.message === 'Ordem Nexus inexistente')
          throw new SalesError(error.message, 404);
        throw error;
      }
      return engine.snapshot();
    },
  );
}
