import { EventEmitter } from 'node:events';

import type {
  MessagingCapabilities,
  MessagingConnection,
  MessagingProviderId,
} from '../../../../core/src/messaging.js';
export type ProviderEvent =
  | { type: 'state'; status: MessagingConnection['status']; account?: string }
  | { type: 'qr'; value: string }
  | { type: 'message'; id: string; remoteId: string; name: string; body: string }
  | { type: 'human'; id: string; remoteId: string; body: string }
  | { type: 'receipt'; id: string; confirmed: boolean }
  | { type: 'error'; code: string };
export interface SendResult {
  id: string;
  confirmation: 'confirmed' | 'pending';
}
export interface MessagingProvider {
  readonly id: MessagingProviderId;
  readonly simulated: boolean;
  readonly capabilities: MessagingCapabilities;
  readonly limitations: string[];
  on(event: 'event', listener: (event: ProviderEvent) => void): unknown;
  removeAllListeners(): unknown;
  connect(): Promise<void>;
  disconnect(revoke?: boolean): Promise<void>;
  send(remoteId: string, body: string): Promise<SendResult>;
}
export const NO_CAPABILITIES: MessagingCapabilities = {
  send: false,
  qr: false,
  receipts: false,
  history: false,
  reliableHumanDetection: false,
  automatic: false,
};
/** Deliberately has no HTTP implementation, credentials or webhook route. */
export class WhatsAppCloudApiProvider extends EventEmitter implements MessagingProvider {
  readonly id = 'cloud_api' as const;
  readonly simulated = false;
  readonly capabilities = { ...NO_CAPABILITIES };
  readonly limitations = [
    'API oficial preparada por contrato; transporte, credenciais, webhooks assinados e políticas ainda não implementados.',
  ];
  async connect(): Promise<void> {
    throw new Error('API oficial ainda não implementada');
  }
  async disconnect(): Promise<void> {
    /* no external connection */
  }
  async send(): Promise<SendResult> {
    throw new Error('Provider sem capacidade de envio');
  }
}
