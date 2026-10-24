/** Deno/Base44 deployment TEMPLATE — not deployed or authenticated by this repository. */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.57';
import type { FeedEvent } from './feedHandler.ts';
import { createFeedHandler } from './feedHandler.ts';
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
      // OfficeConversionEvent is a NEW, dedicated append-only contract entity. Create it
      // with private permissions. Only trusted backend domain code may publish facts to it.
      // Do not replace it with a broad User/payment dump or expose admin entities externally.
      const page = await base44.asServiceRole.entities.OfficeConversionEvent.list({
        sort: 'created_date',
        limit,
        cursor: cursor ?? undefined,
      });
      return {
        events: page.items.map((item: Record<string, unknown>) => item.payload as FeedEvent),
        nextCursor: page.next_cursor ?? null,
      };
    },
  })(req),
);
