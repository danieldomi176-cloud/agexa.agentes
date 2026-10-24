/** Fixed capability catalogue. No arbitrary routes, SQL, shell, secrets or provider setup. */
export const CEO_OPERATIONS = {
  'office.state': ['read', 'GET', '/state'],
  'tasks.list': ['read', 'GET', '/tasks'],
  'tasks.get': ['read', 'GET', '/tasks/:id'],
  'nexus.workflows': ['read', 'GET', '/nexus'],
  'crm.overview': ['read', 'GET', '/crm'],
  'crm.companies': ['read', 'GET', '/crm/companies'],
  'crm.company': ['read', 'GET', '/crm/companies/:id'],
  'conversion.overview': ['read', 'GET', '/conversion'],
  'conversion.events': ['read', 'GET', '/conversion/events'],
  'reports.orion': ['read', 'GET', '/reports/orion'],
  'integrations.state': ['read', 'GET', '/state'],
  'messages.list': ['read', 'GET', '/messaging/conversations'],
  'messages.detail': ['read', 'GET', '/messaging/conversations/:id'],
  'audit.list': ['read', 'GET', 'bridge-audit'],
  'nexus.command': ['control', 'POST', '/commands'],
  'nexus.order': ['control', 'POST', '/crm/orders'],
  'task.approve': ['control', 'POST', '/tasks/:id/approve'],
  'task.cancel': ['control', 'POST', '/tasks/:id/cancel'],
  'workflow.approve': ['control', 'POST', '/workflows/:id/approve'],
  'workflow.cancel': ['control', 'POST', '/workflows/:id/cancel'],
  'order.approve': ['control', 'POST', '/crm/orders/:id/approve'],
  'order.cancel': ['control', 'POST', '/crm/orders/:id/cancel'],
  'employee.set': ['control', 'POST', '/employees/:id'],
  'operations.set': ['control', 'POST', '/operations'],
  'operations.stop': ['control', 'POST', '/messaging/stop'],
  'crm.draft.review': ['control', 'POST', '/crm/drafts/:id/review'],
  'message.review': ['control', 'POST', '/messaging/drafts/:id/review'],
} as const;
export type CeoOperation = keyof typeof CEO_OPERATIONS;
export interface CeoInput {
  params?: { id: string };
  query?: Record<string, string | number>;
  body?: Record<string, unknown>;
}
export interface CeoBrowserRequest {
  operation: CeoOperation;
  requestId: string;
  input: CeoInput;
  confirm?: boolean;
}
export interface CeoBridgeRequest extends CeoBrowserRequest {
  actorId: string;
}
export function ceoCanonical(value: unknown, depth = 0): string {
  if (depth > 20) throw Error('Input nesting limit');
  if (Array.isArray(value))
    return '[' + value.map((v) => ceoCanonical(v, depth + 1)).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + ceoCanonical(v, depth + 1))
        .join(',') +
      '}'
    );
  const text = JSON.stringify(value);
  if (text === undefined) throw Error('Unsupported JSON value');
  return text;
}
export function parseCeoRequest(value: unknown, backend: boolean): CeoBridgeRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid envelope');
  const r = value as CeoBridgeRequest;
  const allowed = ['operation', 'requestId', 'input', 'confirm', ...(backend ? ['actorId'] : [])];
  if (
    Object.keys(r).some((k) => !allowed.includes(k)) ||
    typeof r.operation !== 'string' ||
    !Object.hasOwn(CEO_OPERATIONS, r.operation) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.requestId) ||
    (backend && (typeof r.actorId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(r.actorId))) ||
    (r.confirm !== undefined && typeof r.confirm !== 'boolean') ||
    !r.input ||
    typeof r.input !== 'object' ||
    Array.isArray(r.input) ||
    Object.keys(r.input).some((k) => !['params', 'query', 'body'].includes(k))
  )
    throw Error('Invalid envelope');
  for (const object of [r.input.params, r.input.query, r.input.body])
    if (object !== undefined && (!object || typeof object !== 'object' || Array.isArray(object)))
      throw Error('Invalid input');
  if (
    r.input.params &&
    (Object.keys(r.input.params).some((k) => k !== 'id') ||
      typeof r.input.params.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(r.input.params.id))
  )
    throw Error('Invalid ID');
  if (
    r.input.query &&
    (Object.keys(r.input.query).length > 10 ||
      Object.values(r.input.query).some(
        (v) =>
          !(typeof v === 'string' && v.length <= 200) &&
          !(typeof v === 'number' && Number.isSafeInteger(v)),
      ))
  )
    throw Error('Invalid query');
  const [, method, target] = CEO_OPERATIONS[r.operation];
  if (
    target.includes(':id') !== !!r.input.params ||
    (method === 'GET' && r.input.body !== undefined) ||
    (method === 'POST' && r.input.query !== undefined)
  )
    throw Error('Invalid input');
  if (method === 'POST' && r.confirm !== true) throw Error('Explicit confirmation required');
  ceoCanonical(r.input);
  return r;
}
