import { boundedText } from '../../integrations/base44/officeProtocol.js';
import { type AccessEnv, authorized } from './access.js';
import { control, cycle, enqueue, type Env, snapshot } from './runtime.js';
interface WorkerEnv extends Env, AccessEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}
export default {
  async scheduled(
    _event: unknown,
    env: WorkerEnv,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) {
    ctx.waitUntil(cycle(env));
  },
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    if (!(await authorized(request, env)))
      return json({ error: 'CEO authentication required' }, 401);
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/state') return json(await snapshot(env));
    if (request.method === 'POST') {
      if (
        request.headers.get('origin') !== url.origin ||
        request.headers.get('content-type') !== 'application/json'
      )
        return json({ error: 'Origin/JSON required' }, 403);
      if (Number(request.headers.get('content-length') ?? 0) > 8192)
        return json({ error: 'Too large' }, 413);
      let raw: string;
      try {
        raw = await boundedText(request, 8192);
      } catch {
        return json({ error: 'Too large' }, 413);
      }
      if (raw.length > 8192) return json({ error: 'Too large' }, 413);
      try {
        const body = JSON.parse(raw);
        if (body.confirm !== true) return json({ error: 'Human confirmation required' }, 400);
        if (url.pathname === '/api/control' && ['pause', 'resume', 'stop'].includes(body.action)) {
          await control(env, body.action);
          return json({ saved: true });
        }
        if (
          url.pathname === '/api/employee' &&
          /^(nexus|hunter|atlas|maya|luna|victor|sophia|orion)$/.test(body.id) &&
          typeof body.enabled === 'boolean'
        ) {
          await control(env, 'pause');
          await env.DB.prepare('UPDATE employees SET enabled=? WHERE id=?')
            .bind(body.enabled ? 1 : 0, body.id)
            .run();
          return json({ saved: true });
        }
        if (
          url.pathname === '/api/order' &&
          body.authorized === true &&
          ['research', 'provided'].includes(body.mode)
        ) {
          await enqueue(env, body.id, body.companyId, body.objective, body.mode, body.readyAt);
          return json({ created: true }, 201);
        }
      } catch {
        return json({ error: 'Invalid, conflicting or unavailable operation' }, 400);
      }
      return json({ error: 'Unsupported operation' }, 404);
    }
    if (
      request.method === 'GET' &&
      (url.pathname === '/' || url.pathname.startsWith('/characters/'))
    )
      return env.ASSETS.fetch(request);
    return json({ error: 'Not found' }, 404);
  },
};
