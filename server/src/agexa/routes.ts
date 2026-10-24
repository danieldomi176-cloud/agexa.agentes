import * as fs from 'node:fs';
import * as path from 'node:path';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { CreateSalesTask, EmployeeId } from '../../../core/src/agexa.js';
import { getDataDirectory } from '../dataDirectory.js';
import { readLayoutFromFile, writeLayoutToFile } from '../layoutPersistence.js';
import {
  bearerTokenValid,
  isAllowedWebSocketOrigin,
  standaloneHandshakeVerdict,
} from '../wsAuth.js';
import { SalesEngine, SalesError } from './engine.js';

export async function registerSalesRoutes(
  app: FastifyInstance,
  options: {
    engine: SalesEngine;
    token: string;
    allowedHosts: ReadonlySet<string>;
    layout: Record<string, unknown> | null;
    onLayout: (layout: Record<string, unknown>) => void;
  },
): Promise<void> {
  const { engine, token, allowedHosts } = options;
  app.get('/api/agexa/enabled', async (_request, reply) =>
    reply.header('Cache-Control', 'no-store').send({ enabled: true }),
  );
  await app.register(
    async (api) => {
      api.addHook('onRequest', async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const websocket = request.headers.upgrade?.toLowerCase() === 'websocket';
        const allowed = websocket
          ? standaloneHandshakeVerdict(request.url, request.headers.host, token, allowedHosts) ===
            'privileged'
          : bearerTokenValid(request.headers.authorization, token) &&
            allowedHosts.has(request.hostname.toLowerCase());
        if (!allowed || !isAllowedWebSocketOrigin(request.headers.origin, request.headers.host)) {
          reply.code(401).send({ error: 'Autenticação administrativa necessária' });
        }
      });
      api.setErrorHandler((error, _request, reply) => {
        const status =
          error instanceof SalesError
            ? error.statusCode
            : (error as { validation?: unknown }).validation
              ? 400
              : 500;
        reply.code(status).send({
          error:
            status === 500
              ? 'Falha interna comercial; consultar o operador'
              : error instanceof Error
                ? error.message
                : 'Operação inválida',
        });
      });
      api.get('/state', async () => engine.snapshot());
      api.get('/events', { websocket: true }, (socket) => {
        const send = (): void => {
          if (socket.readyState === 1) socket.send(JSON.stringify(engine.snapshot()));
        };
        engine.on('changed', send);
        // Heartbeat detects stale connections without pretending an agent is active.
        let alive = true;
        socket.on('pong', () => {
          alive = true;
        });
        const heartbeat = setInterval(() => {
          if (!alive) {
            socket.terminate();
            return;
          }
          if (socket.readyState === 1) {
            alive = false;
            socket.ping();
          }
        }, 20000);
        socket.on('close', () => {
          clearInterval(heartbeat);
          engine.off('changed', send);
        });
        socket.on('error', () => socket.close());
        send();
      });
      api.post<{ Body: CreateSalesTask }>(
        '/tasks',
        {
          schema: {
            body: {
              type: 'object',
              required: ['employeeId', 'kind', 'objective', 'input'],
              additionalProperties: false,
              properties: {
                employeeId: { type: 'string', maxLength: 20 },
                kind: {
                  type: 'string',
                  enum: ['prepare_brief', 'qualify_company', 'sales_report', 'ai_request'],
                },
                objective: { type: 'string', minLength: 1, maxLength: 2000 },
                input: { type: 'object' },
                priority: { type: 'integer', minimum: 0, maximum: 10 },
                requiresApproval: { type: 'boolean' },
              },
            },
          },
        },
        async (request, reply) => reply.code(201).send(engine.create(request.body)),
      );
      api.post<{ Params: { id: EmployeeId }; Body: { enabled: boolean } }>(
        '/employees/:id',
        {
          schema: {
            body: {
              type: 'object',
              required: ['enabled'],
              additionalProperties: false,
              properties: { enabled: { type: 'boolean' } },
            },
          },
        },
        async (request) => {
          engine.setEmployee(request.params.id, request.body.enabled);
          return engine.snapshot();
        },
      );
      api.post<{ Body: { suspended: boolean } }>(
        '/operations',
        {
          schema: {
            body: {
              type: 'object',
              required: ['suspended'],
              additionalProperties: false,
              properties: { suspended: { type: 'boolean' } },
            },
          },
        },
        async (request) => {
          engine.suspend(request.body.suspended);
          return engine.snapshot();
        },
      );
      api.post<{ Params: { id: string; action: string }; Body: { recipient?: EmployeeId } }>(
        '/tasks/:id/:action',
        {
          schema: {
            body: {
              type: 'object',
              additionalProperties: false,
              properties: { recipient: { type: 'string', maxLength: 20 } },
            },
          },
        },
        async (request) => {
          const { id, action } = request.params;
          if (action === 'approve') engine.approve(id);
          else if (action === 'cancel') engine.cancel(id);
          else if (action === 'transfer' && request.body.recipient)
            return engine.transfer(id, request.body.recipient);
          else throw new SalesError('Ação inválida', 400);
          return engine.getTask(id);
        },
      );
      api.post<{ Body: { confirm: boolean } }>(
        '/layout',
        {
          schema: {
            body: {
              type: 'object',
              required: ['confirm'],
              properties: { confirm: { const: true } },
            },
          },
        },
        async () => {
          if (!options.layout) throw new SalesError('Layout Agexa indisponível', 503);
          const previous = readLayoutFromFile();
          if (previous)
            fs.writeFileSync(
              path.join(getDataDirectory(), `layout-backup-${Date.now()}.json`),
              JSON.stringify(previous),
              { flag: 'wx', mode: 0o600 },
            );
          writeLayoutToFile(options.layout);
          if (JSON.stringify(readLayoutFromFile()) !== JSON.stringify(options.layout)) {
            throw new SalesError('Não foi possível persistir o layout', 500);
          }
          options.onLayout(options.layout);
          return { saved: true, backupCreated: !!previous };
        },
      );
      // Never let an unknown API route turn into an HTML success through the SPA fallback.
      api.setNotFoundHandler((_request: FastifyRequest, reply) =>
        reply.code(404).send({ error: 'Operação inexistente' }),
      );
    },
    { prefix: '/api/agexa' },
  );
}
