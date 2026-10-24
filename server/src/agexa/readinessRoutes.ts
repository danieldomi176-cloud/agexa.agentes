import type { FastifyInstance } from 'fastify';

import type { EmployeeId } from '../../../core/src/agexa.js';
import { EMPLOYEES } from '../../../core/src/agexa.js';
import type { OfferVerification } from '../../../core/src/readiness.js';
import type { SalesEngine } from './engine.js';

/** Registered exclusively inside the existing authenticated admin scope. */
export function registerReadinessRoutes(api: FastifyInstance, engine: SalesEngine): void {
  api.get('/readiness', async () => engine.operational.check());
  api.post('/readiness/check', async () => {
    await engine.refreshIntelligence();
    return engine.operational.recordCheck();
  });
  api.post('/readiness/backup', async () => engine.operational.createBackup());
  api.post<{ Params: { id: EmployeeId } }>(
    '/readiness/employees/:id/inference',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { enum: EMPLOYEES.map((e) => e.id) } },
        },
      },
    },
    async (req) => {
      await engine.refreshIntelligence();
      return engine.validateInference(req.params.id);
    },
  );
  const text = { type: 'string', minLength: 10, maxLength: 1000 };
  api.post<{ Body: OfferVerification }>(
    '/readiness/offer',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'registrationEvidence',
            'startsWhen',
            'expiryBehaviour',
            'paymentRequired',
            'includedFeatures',
            'confirmed',
          ],
          properties: {
            registrationEvidence: text,
            startsWhen: text,
            expiryBehaviour: text,
            paymentRequired: { type: 'boolean' },
            includedFeatures: text,
            confirmed: { const: true },
          },
        },
      },
    },
    async (req) => {
      engine.operational.verifyOffer(req.body);
      return engine.operational.check();
    },
  );
}
