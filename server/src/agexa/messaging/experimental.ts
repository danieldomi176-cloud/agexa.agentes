import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type * as WA from 'whatsapp-web.js';

import type { MessagingProvider, ProviderEvent, SendResult } from './provider.js';
export type WebClient = Pick<
  WA.Client,
  'on' | 'initialize' | 'destroy' | 'logout' | 'sendMessage' | 'info'
>;
export type WebClientFactory = (sessionPath: string) => Promise<WebClient>;
/** Uses the library's supported LocalAuth; never caches Web HTML remotely or logs QR values. */
export class WhatsAppWebExperimentalProvider extends EventEmitter implements MessagingProvider {
  readonly id = 'web_experimental' as const;
  readonly simulated = false;
  readonly capabilities = {
    send: true,
    qr: true,
    receipts: true,
    history: false,
    reliableHumanDetection: false,
    automatic: false,
  };
  readonly limitations = [
    'Cliente não oficial: sujeito a restrições e bloqueio. Só número de testes.',
    'A deteção de intervenção humana é parcial; atendimento automático bloqueado.',
    'Apenas texto individual @c.us e novas mensagens; sem resolução automática @lid, histórico remoto, grupos ou anexos.',
  ];
  private client: WebClient | null = null;
  private ready = false;
  private closed = false;
  private inFlight = 0;
  private readonly ownIds = new Set<string>();
  constructor(
    readonly sessionPath: string,
    private readonly factory: WebClientFactory = createWebClient,
  ) {
    super();
  }
  private event(value: ProviderEvent): void {
    if (!this.closed) this.emit('event', value);
  }
  async connect(): Promise<void> {
    if (this.client) throw Error('Desligar antes de voltar a ligar');
    this.closed = false;
    fs.mkdirSync(this.sessionPath, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.sessionPath, 0o700);
    const client = await this.factory(this.sessionPath);
    if (this.closed) {
      await client.destroy();
      return;
    }
    this.client = client;
    client.on('qr', (value: string) => this.event({ type: 'qr', value }));
    client.on('authenticated', () => this.event({ type: 'state', status: 'authenticated' }));
    client.on('ready', () => {
      this.ready = true;
      this.event({
        type: 'state',
        status: 'connected',
        account: client.info?.wid?._serialized?.replace(/@c\.us$/, ''),
      });
    });
    client.on('auth_failure', () => {
      this.ready = false;
      this.event({
        type: 'error',
        code: 'Falha de autenticação; revogar sessão e associar novamente.',
      });
    });
    client.on('disconnected', () => {
      this.ready = false;
      this.event({ type: 'state', status: 'disconnected' });
    });
    client.on('message', (m: WA.Message) => {
      if (m.fromMe || !/^\d{8,15}@c\.us$/.test(m.from) || m.type !== 'chat' || !m.body) return;
      this.event({
        type: 'message',
        id: m.id._serialized,
        remoteId: m.from,
        name: '',
        body: m.body,
      });
    });
    client.on('message_ack', (m: WA.Message, ack: number) => {
      if (ack >= 1) this.event({ type: 'receipt', id: m.id._serialized, confirmed: true });
    });
    client.on('message_create', (m: WA.Message) => {
      if (
        m.fromMe &&
        !this.inFlight &&
        !this.ownIds.has(m.id._serialized) &&
        /^\d{8,15}@c\.us$/.test(m.to)
      )
        this.event({
          type: 'human',
          id: m.id._serialized,
          remoteId: m.to,
          body: m.body || '[Mensagem não textual enviada manualmente]',
        });
    });
    this.event({ type: 'state', status: 'connecting' });
    await client.initialize();
  }
  async disconnect(revoke = false): Promise<void> {
    this.ready = false;
    this.closed = true;
    const client = this.client;
    this.client = null;
    // A failed remote logout must not be reported as revocation success.
    if (client) {
      try {
        if (revoke) await client.logout();
      } finally {
        await client.destroy();
      }
    }
    if (revoke)
      fs.rmSync(path.join(this.sessionPath, 'session-agexa-test'), {
        recursive: true,
        force: true,
      });
  }
  async send(remoteId: string, body: string): Promise<SendResult> {
    if (!this.ready || !this.client) throw Error('WhatsApp experimental não está ligado');
    if (!/^\d{8,15}@c\.us$/.test(remoteId)) throw Error('Apenas conversas individuais autorizadas');
    this.inFlight++;
    try {
      const m = await this.client.sendMessage(remoteId, body, { linkPreview: false });
      this.ownIds.add(m.id._serialized);
      if (this.ownIds.size > 1000) this.ownIds.delete(this.ownIds.values().next().value!);
      return { id: m.id._serialized, confirmation: Number(m.ack) >= 1 ? 'confirmed' : 'pending' };
    } finally {
      this.inFlight--;
    }
  }
}
async function createWebClient(sessionPath: string): Promise<WebClient> {
  const lib = await import('whatsapp-web.js');
  const { Client, LocalAuth } = lib;
  const executablePath = process.env.AGEXA_WHATSAPP_CHROMIUM_PATH;
  if (!executablePath || !path.isAbsolute(executablePath) || !fs.existsSync(executablePath))
    throw Error(
      'Configurar AGEXA_WHATSAPP_CHROMIUM_PATH para Chromium instalado; nenhum navegador é descarregado automaticamente.',
    );
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (proxy && (new URL(proxy).username || new URL(proxy).password))
    throw Error(
      'Proxy autenticado exige transporte de navegador suportado; não colocar credenciais em argumentos.',
    );
  return new Client({
    authStrategy: new LocalAuth({ clientId: 'agexa-test', dataPath: sessionPath }),
    webVersionCache: { type: 'none' },
    puppeteer: { headless: true, executablePath, args: proxy ? ['--proxy-server=' + proxy] : [] },
    qrMaxRetries: 5,
  });
}
