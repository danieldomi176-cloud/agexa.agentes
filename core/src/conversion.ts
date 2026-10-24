import type { EmployeeId } from './agexa.js';
export type ConversionKind =
  | 'account_created'
  | 'trial_started'
  | 'trial_extended'
  | 'trial_ended'
  | 'trial_cancelled'
  | 'payment_confirmed';
export type ConfirmationOrigin = 'integration' | 'manual' | 'simulated';
export interface ConversionFact {
  eventId: string;
  appId: string;
  kind: ConversionKind;
  occurredAt: string;
  accountId: string;
  reference?: string;
  startAt?: string;
  endAt?: string;
  paymentId?: string;
  amountMinor?: number;
  currency?: string;
  verified?: boolean;
  evidence: string;
}
export interface ConversionConfig {
  appId: string;
  endpoint: string | null;
  syncMode: 'manual' | 'on_demand';
  authType: 'hmac-sha256';
  referenceSupported: boolean;
  referenceParameter: string;
  permissionEvidence: string;
  retentionDays: number;
}
export interface ConversionInvite {
  id: string;
  companyId: string;
  conversationId: string;
  draftId: string;
  reference: string;
  employeeId: EmployeeId | 'ceo';
  preparedAt: string;
  confirmedAt: string | null;
  officialUrl: string;
  sentUrl: string;
  simulated: boolean;
  confirmationOrigin: ConfirmationOrigin | null;
}
export interface ConversionAccount {
  id: string;
  companyId: string;
  appId: string;
  externalId: string;
  origin: ConfirmationOrigin;
  createdAt: string;
}
export interface TrialRecord {
  id: string;
  companyId: string;
  accountId: string;
  startAt: string;
  endAt: string;
  status: 'active' | 'expired' | 'cancelled' | 'converted';
  updatedAt: string;
  origin: ConfirmationOrigin;
  remainingDays: number;
  effectiveState: string;
  actualDurationDays: number;
}
export interface ConversionEvent {
  id: string;
  appId: string;
  externalId: string;
  companyId: string | null;
  kind: ConversionKind;
  occurredAt: string;
  origin: ConfirmationOrigin;
  status: 'pending' | 'applied' | 'rejected';
  reason: string | null;
  payload: ConversionFact | null;
  attribution: string;
  receivedAt: string;
}
export interface ConversionNotice {
  id: string;
  companyId: string;
  conversationId: string | null;
  kind: string;
  body: string;
  createdAt: string;
  seenAt: string | null;
}
export interface CeoFollowup {
  id: string;
  inviteId: string;
  companyId: string;
  conversationId: string;
  notes: string;
  followupAt: string | null;
  closedReason: string | null;
  createdAt: string;
}
export interface ConversionMetrics {
  origins: Record<
    ConfirmationOrigin,
    {
      accounts: number;
      activeTrials: number;
      expiredTrials: number;
      paying: number;
      revenue: Record<string, number>;
    }
  >;
  funnel: {
    key: string;
    label: string;
    count: number;
    origin: string;
    rate: number | null;
    denominator: number | null;
    numerator: number | null;
  }[];
  sectors: { sector: string; accounts: number; paying: number }[];
  employees: { employee: string; accounts: number; paying: number }[];
  awaitingCeo: number;
  pendingEvents: number;
  nearEnd: number;
  closedLost: number;
  legacyManual: { accounts: number; trialsWithoutDates: number; payingWithoutAmount: number };
}
export interface ConversionSnapshot {
  config: ConversionConfig;
  integration: {
    status: string;
    secretConfigured: boolean;
    lastSync: string | null;
    error: string | null;
    cursor: string | null;
    capabilities: string[];
  };
  metrics: ConversionMetrics;
  notices: ConversionNotice[];
  trials: TrialRecord[];
  accounts: ConversionAccount[];
  invites: ConversionInvite[];
  followups: CeoFollowup[];
  validations: {
    id: string;
    taskId: string | null;
    mode: string;
    status: string;
    model: string | null;
    durationMs: number | null;
    createdAt: string;
    detail: string;
  }[];
}
