import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { MessagingProvider, ProviderEvent, SendResult } from './provider.js';
export class MockWhatsAppProvider extends EventEmitter implements MessagingProvider {
  readonly id = 'mock' as const;
  readonly simulated = true;
  readonly capabilities = {
    send: true,
    qr: false,
    receipts: true,
    history: false,
    reliableHumanDetection: true,
    automatic: false,
  };
  readonly limitations = [
    'EXCLUSIVAMENTE SIMULADO. Sem conta, QR de autenticação ou envio externo.',
  ];
  readonly sends: { id: string; remoteId: string; body: string }[] = [];
  outcome: 'confirmed' | 'pending' | 'error' | 'ambiguous' = 'confirmed';
  connected = false;
  private event(value: ProviderEvent): void {
    this.emit('event', value);
  }
  async connect(): Promise<void> {
    this.connected = true;
    this.event({ type: 'state', status: 'connected', account: 'TESTE — sem número real' });
  }
  async disconnect(): Promise<void> {
    this.connected = false;
    this.event({ type: 'state', status: 'disconnected' });
  }
  receive(id: string, remoteId: string, body: string, name = 'Cliente TESTE'): void {
    if (!this.connected) throw Error('Mock disconnected');
    this.event({ type: 'message', id, remoteId, body, name });
  }
  receipt(id: string, confirmed = true): void {
    this.event({ type: 'receipt', id, confirmed });
  }
  human(id: string, remoteId: string, body: string): void {
    this.event({ type: 'human', id, remoteId, body });
  }
  async send(remoteId: string, body: string): Promise<SendResult> {
    if (!this.connected) throw Error('Mock disconnected');
    const id = randomUUID();
    this.sends.push({ id, remoteId, body });
    if (this.outcome === 'error') throw Error('TEST provider send failed');
    if (this.outcome === 'ambiguous') throw Error('TEST uncertain provider response');
    return { id, confirmation: this.outcome };
  }
}
