/** Base44 BACKEND entry. Bundle to one file; verify/deploy inside the authorized app. */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.57';

import { createOfficeGateway } from './officeGatewayHandler.js';
const actors = new Map<string, 'read' | 'control'>();
for (const [name, scope] of [
  ['AGEXA_CEO_READ_IDS', 'read'],
  ['AGEXA_CEO_CONTROL_IDS', 'control'],
] as const)
  for (const id of (Deno.env.get(name) ?? '').split(',').filter(Boolean)) actors.set(id, scope);
Deno.serve(
  createOfficeGateway({
    officeOrigin: Deno.env.get('AGEXA_OFFICE_API_ORIGIN') ?? '',
    frontendOrigin: 'https://agexa-flix.base44.app',
    secret: Deno.env.get('AGEXA_CEO_BRIDGE_SECRET') ?? '',
    actors,
    authenticate: async (request) => {
      const user = await createClientFromRequest(request).auth.me();
      return user && typeof user.id === 'string' ? { id: user.id } : null;
    },
  }),
);
