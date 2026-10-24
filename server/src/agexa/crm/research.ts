import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import * as https from 'node:https';
import * as net from 'node:net';

import type { BusinessSource, CompanyInput } from '../../../../core/src/crm.js';
import { publicWebsite } from './validation.js';

export function publicAddress(address: string): boolean {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (net.isIP(address) === 6)
    return (
      /^[23][0-9a-f]{3}:/i.test(address) &&
      !/^2001:(?:0?db8|0:|0000:)/i.test(address) &&
      !/^2002:/i.test(address)
    );
  return false;
}
export interface WebsiteResponse {
  status: number;
  contentType: string;
  body: string;
}
export interface WebsiteTransport {
  resolve(hostname: string): Promise<{ address: string; family: number }[]>;
  get(url: URL, signal: AbortSignal, limit: number): Promise<WebsiteResponse>;
}
export const safeWebsiteTransport: WebsiteTransport = {
  resolve: (hostname) => lookup(hostname, { all: true }),
  async get(url, signal, limit) {
    // A proxy may resolve a different address. Never bypass it or pretend a local
    // DNS check pins a proxy's DNS. This environment must use CSV/manual until a
    // supported pinned transport is configured by its operator.
    if (
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY ||
      process.env.https_proxy ||
      process.env.http_proxy
    )
      throw new Error(
        'Análise de websites indisponível neste ambiente com proxy: não existe transporte com DNS fixo verificado. Use CSV ou listas autorizadas.',
      );
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some((row) => !publicAddress(row.address)))
      throw new Error('DNS do website aponta para endereço privado ou reservado');
    const selected = addresses[0];
    return new Promise((resolve, reject) => {
      const request = https.request(
        url,
        {
          method: 'GET',
          family: selected.family,
          signal,
          headers: {
            'User-Agent': 'AgexaResearchBot/1.0 (CEO-authorized business research)',
            Accept: 'text/html,text/plain',
            'Accept-Encoding': 'identity',
          },
          lookup: (_host, _options, callback) => callback(null, selected.address, selected.family),
        },
        (response) => {
          if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
            response.destroy();
            reject(new Error('Redirecionamentos de websites não são seguidos'));
            return;
          }
          if (
            response.headers['content-encoding'] &&
            response.headers['content-encoding'] !== 'identity'
          ) {
            response.destroy();
            reject(new Error('Resposta comprimida não suportada para pesquisa segura'));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > limit) {
              response.destroy();
              reject(new Error('Website excede o limite de leitura'));
            } else chunks.push(chunk);
          });
          response.on('error', reject);
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 500,
              contentType: String(response.headers['content-type'] ?? ''),
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      request.on('error', reject);
      request.end();
    });
  },
};
export async function analyzeBusinessWebsite(
  source: BusinessSource,
  company: CompanyInput,
  signal: AbortSignal,
  transport: WebsiteTransport = safeWebsiteTransport,
): Promise<{ company: CompanyInput; observation: Record<string, unknown> }> {
  if (
    !source.enabled ||
    !source.termsReviewed ||
    !source.commercialReuseAllowed ||
    source.kind !== 'website' ||
    !source.url
  )
    throw new Error('Website não autorizado administrativamente');
  const url = publicWebsite(company.website ?? source.url);
  const sourceUrl = publicWebsite(source.url);
  if (
    /(^|\.)(facebook\.com|instagram\.com|google\.com|google\.co\.mz|linkedin\.com)$/.test(
      url.hostname,
    )
  )
    throw new Error(
      'Fonte não suportada para extração automática; usar dados empresariais fornecidos com autorização',
    );
  if (url.origin !== sourceUrl.origin) throw new Error('Website fora da origem autorizada');
  const addresses = await transport.resolve(url.hostname);
  if (!addresses.length || addresses.some((row) => !publicAddress(row.address)))
    throw new Error('DNS privado ou reservado bloqueado');
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  bounded.throwIfAborted();
  const robots = await transport.get(new URL('/robots.txt', url), bounded, 48000);
  if (robots.status !== 404) {
    if (robots.status !== 200 || !robots.contentType.includes('text/plain'))
      throw new Error('Não foi possível verificar robots.txt; pesquisa não executada');
    let agents: string[] = [];
    let hasRules = false;
    for (const line of robots.body.split(/\r?\n/)) {
      const clean = line.split('#')[0].trim();
      if (!clean) {
        agents = [];
        hasRules = false;
        continue;
      }
      const split = clean.indexOf(':');
      if (split < 0) continue;
      const key = clean.slice(0, split).toLowerCase();
      const value = clean.slice(split + 1).trim();
      if (key === 'user-agent') {
        if (hasRules) {
          agents = [];
          hasRules = false;
        }
        agents.push(value.toLowerCase());
        continue;
      }
      if (key === 'allow' || key === 'disallow') hasRules = true;
      const relevant = agents.some((agent) => agent === '*' || agent.includes('agexaresearchbot'));
      if (
        relevant &&
        key === 'disallow' &&
        value &&
        url.pathname.startsWith(value.split('*')[0].replace(/\$$/, ''))
      )
        throw new Error('robots.txt não permite analisar este caminho');
    }
  }
  const response = await transport.get(url, bounded, 262144);
  if (response.status !== 200 || !response.contentType.includes('text/html'))
    throw new Error('Website indisponível ou conteúdo não HTML');
  const strip = (text: string): string =>
    text
      .replace(/<[^>]*>/g, ' ')
      .replace(/&(?:amp|quot|lt|gt|nbsp);/g, ' ')
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[contacto omitido]')
      .replace(/\+?\d[\d\s()-]{7,}\d/g, '[número omitido]')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);
  const title = strip(response.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const meta =
    response.body.match(
      /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
    )?.[1] ?? '';
  return {
    company: { ...company, website: url.toString() },
    observation: {
      sourceUrl: url.toString(),
      observedAt: new Date().toISOString(),
      title,
      description: strip(meta),
      sha256: createHash('sha256').update(response.body).digest('hex'),
      externalContentTrusted: false,
      contactExtracted: false,
    },
  };
}
