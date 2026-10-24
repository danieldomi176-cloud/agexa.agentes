import type { EmployeeId } from './agexa.js';
export type MessagingProviderId = 'none' | 'mock' | 'web_experimental' | 'cloud_api';
export type ChannelMode = 'manual' | 'assisted' | 'automatic';
export interface MessagingCapabilities {
  send: boolean;
  qr: boolean;
  receipts: boolean;
  history: boolean;
  reliableHumanDetection: boolean;
  automatic: boolean;
}
export interface MessagingConnection {
  provider: MessagingProviderId;
  status:
    'disabled' | 'connecting' | 'qr' | 'authenticated' | 'connected' | 'disconnected' | 'error';
  mode: ChannelMode;
  suspended: boolean;
  account: string | null;
  simulated: boolean;
  capabilities: MessagingCapabilities;
  limitations: string[];
  error: string | null;
  qrAvailable: boolean;
}
export interface MessagingConversation {
  id: string;
  provider: MessagingProviderId;
  remoteId: string;
  name: string;
  companyId: string | null;
  owner: EmployeeId | 'ceo';
  state: 'open' | 'human' | 'opted_out' | 'reconciliation';
  simulated: boolean;
  interestedMessageId: string | null;
  acceptedMessageId: string | null;
  updatedAt: string;
  lastMessage: string;
  notes: string;
}
export interface MessagingMessage {
  id: string;
  conversationId: string;
  providerId: string | null;
  direction: 'inbound' | 'outbound';
  body: string;
  status:
    'received' | 'sending' | 'pending' | 'confirmed' | 'failed' | 'reconciliation' | 'observed';
  simulated: boolean;
  createdAt: string;
}
export interface MessagingDraft {
  id: string;
  conversationId: string;
  body: string;
  kind: 'reply' | 'invitation';
  employeeId: EmployeeId | 'ceo';
  mode: 'manual' | 'rules' | 'ollama' | 'gemini' | 'test';
  status: 'proposed' | 'approved' | 'rejected' | 'sending' | 'sent' | 'failed' | 'reconciliation';
  version: number;
  sourceMessageId: string;
  taskId: string | null;
  createdAt: string;
}
export interface MessagingAudit {
  id: number;
  conversationId: string | null;
  action: string;
  detail: string;
  createdAt: string;
}
export interface MessagingDetail {
  conversation: MessagingConversation;
  messages: MessagingMessage[];
  drafts: MessagingDraft[];
  events: MessagingAudit[];
  messagePage: number;
  messageTotal: number;
}
export interface MessagingSnapshot {
  connection: MessagingConnection;
  notifications: MessagingAudit[];
  metrics: {
    realConversations: number;
    simulatedConversations: number;
    confirmedRealSends: number;
    confirmedSimulatedSends: number;
    awaitingApproval: number;
    reconciliation: number;
  };
}
