import { isIP } from 'node:net';

import { readBase44Secret } from '../conversion/secret.js';

export interface CeoConfig {
  publicOrigin: string;
  trustedProxyIp: string;
  actors: ReadonlyMap<string, 'read' | 'control'>;
  secret: () => string;
}
export function ceoConfig(env = process.env): CeoConfig | null {
  if (env.AGEXA_CEO_BRIDGE_ENABLED !== '1') return null;
  const url = new URL(env.AGEXA_OFFICE_PUBLIC_ORIGIN ?? '');
  const proxy = env.AGEXA_CEO_TRUSTED_PROXY_IP ?? '127.0.0.1';
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !isIP(proxy)
  )
    throw Error('Invalid CEO bridge deployment configuration');
  const actors = new Map<string, 'read' | 'control'>();
  for (const [name, scope] of [
    ['AGEXA_CEO_READ_IDS', 'read'],
    ['AGEXA_CEO_CONTROL_IDS', 'control'],
  ] as const)
    for (const id of (env[name] ?? '').split(',').filter(Boolean)) {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw Error('Invalid CEO identity allowlist');
      actors.set(id, scope);
    }
  if (!actors.size) throw Error('CEO identity allowlist required');
  return {
    publicOrigin: url.origin,
    trustedProxyIp: proxy,
    actors,
    secret: () =>
      readBase44Secret({
        AGEXA_BASE44_EVENT_SECRET: env.AGEXA_CEO_BRIDGE_SECRET,
        AGEXA_BASE44_EVENT_SECRET_FILE: env.AGEXA_CEO_BRIDGE_SECRET_FILE,
      }).value,
  };
}
