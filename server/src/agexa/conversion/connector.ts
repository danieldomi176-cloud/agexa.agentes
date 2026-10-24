import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import * as https from 'node:https';

import type { ConversionConfig, ConversionFact } from '../../../../core/src/conversion.js';
import { CrmError } from '../crm/error.js';
import { publicAddress } from '../crm/research.js';
import { publicWebsite } from '../crm/validation.js';
import { sign, validateFact, verify } from './contract.js';
export interface ConversionFeed {
  events: ConversionFact[];
  nextCursor: string | null;
  appId: string;
  nonce: string;
}
export interface SignedResponse {
  body: string;
  headers: Record<string, string>;
  status: number;
}
export type FeedTransport = (
  url: URL,
  body: string,
  headers: Record<string, string>,
  signal: AbortSignal,
) => Promise<SignedResponse>;
/** Dedicated read-only Base44 backend-function contract; no external service-role SDK. */
export class AgexaBase44Connector {
  constructor(
    private readonly transport: FeedTransport = pinnedFeedTransport,
    readonly simulated = false,
  ) {}
  async pull(
    config: ConversionConfig,
    cursor: string | null,
    secret: string,
    signal: AbortSignal,
  ): Promise<ConversionFeed> {
    if (!secret || secret.length < 32)
      throw new CrmError('Configurar segredo de integração no backend, mínimo 32 caracteres');
    if (
      !config.endpoint ||
      !config.appId ||
      config.syncMode !== 'on_demand' ||
      !config.permissionEvidence.trim()
    )
      throw new CrmError('Integração sem endpoint/permissão confirmada');
    const url = publicWebsite(config.endpoint);
    const nonce = randomUUID(),
      stamp = String(Date.now());
    const body = JSON.stringify({ appId: config.appId, cursor, limit: 100, nonce });
    const result = await this.transport(
      url,
      body,
      {
        'Content-Type': 'application/json',
        'X-Agexa-Timestamp': stamp,
        'X-Agexa-Nonce': nonce,
        'X-Agexa-Signature': sign(secret, stamp, nonce, body),
      },
      signal,
    );
    if (result.status !== 200)
      throw new CrmError('Backend Function recusou o pedido ou está indisponível');
    if (Buffer.byteLength(result.body) > 262144) throw new CrmError('Feed excede o limite');
    if (result.headers['x-agexa-nonce'] !== nonce)
      throw new CrmError('Resposta de outra sincronização; replay recusado', 401);
    verify(
      secret,
      result.headers['x-agexa-timestamp'] ?? '',
      nonce,
      result.body,
      result.headers['x-agexa-signature'] ?? '',
    );
    let feed: ConversionFeed;
    try {
      feed = JSON.parse(result.body);
    } catch {
      throw new CrmError('Resposta Base44 não é JSON');
    }
    if (
      !feed ||
      typeof feed !== 'object' ||
      Array.isArray(feed) ||
      feed.appId !== config.appId ||
      feed.nonce !== nonce ||
      !Array.isArray(feed.events) ||
      feed.events.length > 100 ||
      !(
        feed.nextCursor === null ||
        (typeof feed.nextCursor === 'string' && feed.nextCursor.length <= 2000)
      ) ||
      Object.keys(feed).some((k) => !['appId', 'nonce', 'events', 'nextCursor'].includes(k))
    )
      throw new CrmError('Contrato do feed inválido');
    feed.events.forEach((e) => {
      validateFact(e);
      if (e.appId !== config.appId) throw new CrmError('Evento de outra aplicação');
    });
    return feed;
  }
}
export const pinnedFeedTransport: FeedTransport = async (url, body, headers, signal) => {
  if (
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy
  )
    throw new CrmError(
      'Sincronização HTTPS indisponível com este proxy sem transporte de DNS fixado; usar confirmação manual.',
    );
  const addresses = await lookup(url.hostname, { all: true });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some((r) => !publicAddress(r.address)))
    throw new CrmError('DNS privado/reservado recusado');
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        signal,
        family: selected.family,
        lookup: (_host, _options, callback) => callback(null, selected.address, selected.family),
        headers: {
          ...headers,
          'Accept-Encoding': 'identity',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let length = 0;
        res.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > 262144) {
            res.destroy();
            reject(new CrmError('Resposta excede limite'));
          } else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
            reject(new CrmError('Compressão não suportada'));
            return;
          }
          resolve({
            status: res.statusCode ?? 500,
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([k, v]) => [k, String(v ?? '')]),
            ),
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
};
