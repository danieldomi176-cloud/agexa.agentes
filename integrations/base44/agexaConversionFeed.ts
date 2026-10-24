/** Deno/Base44 deployment TEMPLATE — not deployed or authenticated by this repository. */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.57';

import { createFeedHandler } from './feedHandler.js';
import { readConversionFeed } from './feedReader.js';
// Configure in the authorized Base44 backend only. Never expose these to the app's frontend.
const appId = Deno.env.get('AGEXA_BASE44_APP_ID') ?? '';
const secret = Deno.env.get('AGEXA_BASE44_EVENT_SECRET') ?? '';
Deno.serve(async (req: Request) =>
  createFeedHandler({
    appId,
    secret,
    read: async (cursor, limit) => {
      // This closure is called ONLY after HMAC/app/timestamp validation.
      const base44 = createClientFromRequest(req);
      return readConversionFeed(
        base44.asServiceRole.entities.OfficeConversionEvent,
        appId,
        cursor,
        limit,
      );
    },
  })(req),
);
