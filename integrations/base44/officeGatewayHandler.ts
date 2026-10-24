/** CEO BFF only: authenticates Base44 users and forwards a closed Office operation. No agents. */
import { CEO_OPERATIONS, parseCeoRequest } from '../../core/src/ceoBridge.js';
import {
  boundedText,
  CEO_MAX_REQUEST,
  CEO_MAX_RESPONSE,
  CEO_PATH,
  ceoSignature,
  ceoVerify,
} from './officeProtocol.js';

export interface OfficeGatewayDependencies {
  officeOrigin: string;
  frontendOrigin: string;
  secret: string;
  actors: ReadonlyMap<string, 'read' | 'control'>;
  authenticate: (request: Request) => Promise<{ id: string } | null>;
  fetcher?: typeof fetch;
}
export function createOfficeGateway(
  deps: OfficeGatewayDependencies,
): (request: Request) => Promise<Response> {
  const respond = (status: number, value: unknown) =>
    new Response(JSON.stringify(value), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  return async (request) => {
    if (request.method !== 'POST') return respond(405, { error: 'POST required' });
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
      return respond(415, { error: 'JSON required' });
    if (request.headers.has('origin') && request.headers.get('origin') !== deps.frontendOrigin)
      return respond(403, { error: 'Origin denied' });
    let origin: URL;
    try {
      origin = new URL(deps.officeOrigin);
      if (
        origin.protocol !== 'https:' ||
        origin.username ||
        origin.password ||
        origin.pathname !== '/' ||
        origin.search ||
        origin.hash ||
        deps.secret.length < 32 ||
        !deps.actors.size
      )
        throw Error('Not configured');
    } catch {
      return respond(503, { error: 'Office gateway is not configured' });
    }
    let user: { id: string } | null;
    try {
      user = await deps.authenticate(request);
    } catch {
      return respond(401, { error: 'Base44 login required' });
    }
    if (!user) return respond(401, { error: 'Base44 login required' });
    const scope = deps.actors.get(user.id);
    if (!scope) return respond(403, { error: 'CEO access required' });
    let input;
    try {
      input = parseCeoRequest(JSON.parse(await boundedText(request, CEO_MAX_REQUEST)), false);
    } catch {
      return respond(400, { error: 'Invalid request or confirmation missing' });
    }
    if (CEO_OPERATIONS[input.operation][0] === 'control' && scope !== 'control')
      return respond(403, { error: 'Read-only session' });
    const raw = JSON.stringify({ ...input, actorId: user.id });
    if (new TextEncoder().encode(raw).length > CEO_MAX_REQUEST)
      return respond(413, { error: 'Request too large' });
    const nonce = crypto.randomUUID(),
      stamp = String(Date.now());
    try {
      const response = await (deps.fetcher ?? fetch)(new URL(CEO_PATH, origin), {
        method: 'POST',
        body: raw,
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: {
          'Content-Type': 'application/json',
          'X-Agexa-Timestamp': stamp,
          'X-Agexa-Nonce': nonce,
          'X-Agexa-Signature': await ceoSignature(deps.secret, 'request', stamp, nonce, raw),
        },
      });
      const body = await boundedText(response, CEO_MAX_RESPONSE);
      if (
        response.headers.get('X-Agexa-Nonce') !== nonce ||
        !(await ceoVerify(
          deps.secret,
          'response',
          response.headers.get('X-Agexa-Timestamp') ?? '',
          nonce,
          body,
          response.headers.get('X-Agexa-Signature') ?? '',
        ))
      )
        throw Error('Invalid Office response');
      const result = JSON.parse(body);
      if (
        result.requestId !== input.requestId ||
        result.status !== response.status ||
        result.ok !== response.ok ||
        Object.keys(result).some((k) => !['requestId', 'status', 'ok', 'result'].includes(k))
      )
        throw Error('Invalid response contract');
      // No upstream headers, credentials or signature material are forwarded to the browser.
      return respond(response.status, result);
    } catch {
      return respond(502, {
        error:
          'Office unavailable or response authentication failed; do not repeat actions with a new ID before review',
      });
    }
  };
}
