import type { FastifyInstance } from 'fastify';

import type { CeoBridgeRequest } from '../../../../core/src/ceoBridge.js';
import { CEO_OPERATIONS, parseCeoRequest } from '../../../../core/src/ceoBridge.js';
import {
  CEO_MAX_REQUEST,
  CEO_MAX_RESPONSE,
  CEO_PATH,
  ceoSignature,
  ceoVerify,
} from '../../../../integrations/base44/officeProtocol.js';
import type { SalesEngine } from '../engine.js';
import type { CeoConfig } from './config.js';
import { CeoError, CeoStore } from './store.js';

function overview(engine: SalesEngine): unknown {
  const s = engine.snapshot();
  return {
    version: s.version,
    suspended: s.suspended,
    employees: s.employees,
    tasks: s.tasks.map(({ input: _input, result, ...task }) => ({
      ...task,
      resultAvailable: result !== null,
    })),
    events: s.events,
    inference: s.inference,
    objective: s.objective,
  };
}
/** A closed server-to-server façade. The existing internal auth remains unchanged. */
export async function registerCeoRoutes(
  app: FastifyInstance,
  engine: SalesEngine,
  token: string,
  config: CeoConfig | null,
): Promise<void> {
  const store = config ? new CeoStore(engine.conversion.store.db) : null;
  let minute = 0,
    attempts = 0;
  await app.register(
    async (api) => {
      api.addContentTypeParser(
        'application/json',
        { parseAs: 'string', bodyLimit: CEO_MAX_REQUEST },
        (_req, body, done) => done(null, body),
      );
      api.addHook('onRequest', async (req, reply) => {
        reply
          .header('Cache-Control', 'no-store, private')
          .header('X-Content-Type-Options', 'nosniff');
        const now = Math.floor(Date.now() / 60000);
        if (now !== minute) {
          minute = now;
          attempts = 0;
        }
        if (++attempts > 300) return reply.code(429).send({ error: 'Limite de pedidos' });
        if (!config || !store)
          return reply.code(503).send({ error: 'Ponte administrativa não configurada' });
        if (
          req.headers.origin !== undefined ||
          req.headers.host !== new URL(config.publicOrigin).host ||
          req.ip !== config.trustedProxyIp ||
          req.headers['x-forwarded-proto'] !== 'https' ||
          req.url !== CEO_PATH
        ) {
          store.audit('untrusted', 'transport.denied', '-', 403);
          return reply.code(403).send({ error: 'Canal de acesso recusado' });
        }
      });
      api.setErrorHandler((error, _req, reply) => {
        const status =
          error instanceof CeoError
            ? error.status
            : (error as { statusCode?: number }).statusCode === 413
              ? 413
              : 400;
        reply
          .code(status)
          .send({ error: status === 413 ? 'Pedido demasiado grande' : 'Pedido recusado' });
      });
      api.post('/request', async (req, reply) => {
        if (!config || !store) return reply.code(503).send({ error: 'Ponte indisponível' });
        const secret = config.secret();
        if (secret.length < 32)
          return reply.code(503).send({ error: 'Segredo da ponte indisponível' });
        const raw = req.body;
        const stamp = String(req.headers['x-agexa-timestamp'] ?? ''),
          nonce = String(req.headers['x-agexa-nonce'] ?? '');
        if (
          typeof raw !== 'string' ||
          !(await ceoVerify(
            secret,
            'request',
            stamp,
            nonce,
            raw,
            String(req.headers['x-agexa-signature'] ?? ''),
          ))
        ) {
          store.audit('untrusted', 'auth.denied', '-', 401);
          return reply.code(401).send({ error: 'Autenticação da ponte recusada' });
        }
        let input: CeoBridgeRequest;
        try {
          input = parseCeoRequest(JSON.parse(raw), true);
        } catch {
          throw new CeoError('Contrato inválido');
        }
        const scope = config.actors.get(input.actorId);
        let status = 200,
          result: unknown;
        try {
          if (!scope) throw new CeoError('Identidade não autorizada', 403);
          store.consume(input.actorId, nonce);
          if (CEO_OPERATIONS[input.operation][0] === 'control' && scope !== 'control')
            throw new CeoError('Permissão insuficiente', 403);
          const cached =
            CEO_OPERATIONS[input.operation][0] === 'control'
              ? store.reserve(input.requestId, input.actorId, JSON.stringify(input))
              : null;
          if (cached) {
            status = cached.http;
            result = JSON.parse(cached.response);
          } else {
            const response = await dispatch(app, engine, token, input, store);
            status = response.status;
            result = response.result;
            if (CEO_OPERATIONS[input.operation][0] === 'control')
              store.finish(input.requestId, status, JSON.stringify(result));
          }
        } catch (error) {
          status = error instanceof CeoError ? error.status : 500;
          result = {
            error:
              error instanceof CeoError
                ? error.message
                : 'Falha interna; consultar o operador antes de repetir ações',
          };
        }
        store.audit(scope ? input.actorId : 'untrusted', input.operation, input.requestId, status);
        const body = JSON.stringify({
          requestId: input.requestId,
          ok: status < 400,
          status,
          result,
        });
        if (Buffer.byteLength(body) > CEO_MAX_RESPONSE)
          return reply
            .code(503)
            .send({ error: 'Resposta demasiado grande; usar consultas paginadas' });
        const responseStamp = String(Date.now());
        reply
          .header('X-Agexa-Timestamp', responseStamp)
          .header('X-Agexa-Nonce', nonce)
          .header(
            'X-Agexa-Signature',
            await ceoSignature(secret, 'response', responseStamp, nonce, body),
          );
        return reply.code(status).type('application/json').send(body);
      });
      api.setNotFoundHandler((_req, reply) =>
        reply.code(404).send({ error: 'Operação inexistente' }),
      );
    },
    { prefix: '/api/ceo/v1' },
  );
}
async function dispatch(
  app: FastifyInstance,
  engine: SalesEngine,
  token: string,
  r: CeoBridgeRequest,
  store: CeoStore,
): Promise<{ status: number; result: unknown }> {
  if (r.operation === 'office.state') return { status: 200, result: overview(engine) };
  if (r.operation === 'audit.list') return { status: 200, result: store.recent() };
  if (r.operation === 'integrations.state') {
    const s = engine.snapshot(),
      b = s.conversion!,
      m = s.messaging!.connection;
    return {
      status: 200,
      result: {
        ia: {
          ...s.inference,
          model: s.intelligence?.config.model ?? null,
          credentialConfigured: s.intelligence?.status.credentialConfigured ?? false,
        },
        base44: {
          appId: b.config.appId,
          endpointConfigured: !!b.config.endpoint,
          status: b.integration.status,
          secretConfigured: b.integration.secretConfigured,
          lastSync: b.integration.lastSync,
          error: b.integration.error,
        },
        whatsapp: {
          provider: m.provider,
          status: m.status,
          simulated: m.simulated,
          qrAvailable: m.qrAvailable,
        },
      },
    };
  }
  const [, method, target] = CEO_OPERATIONS[r.operation];
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(r.input.query ?? {})) query.set(key, String(value));
  const path = target.replace(':id', r.input.params?.id ?? '');
  const response = await app.inject({
    method,
    url: '/api/agexa' + path + (query.size ? '?' + query : ''),
    headers: { host: '127.0.0.1', authorization: `Bearer ${token}` },
    ...(method === 'POST' ? { payload: r.input.body ?? {} } : {}),
  });
  const result =
    response.statusCode >= 500 ? { error: 'Serviço interno indisponível' } : response.json();
  if (
    response.statusCode < 400 &&
    ['/operations', '/employees/:id', '/workflows/:id/approve', '/workflows/:id/cancel'].includes(
      target,
    )
  )
    return { status: response.statusCode, result: overview(engine) };
  return { status: response.statusCode, result };
}
