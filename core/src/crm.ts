import type { EmployeeId } from './agexa.js';

export const PIPELINE = [
  ['identified', 'EMPRESA IDENTIFICADA'],
  ['analysis', 'EM ANÁLISE'],
  ['qualified', 'OPORTUNIDADE QUALIFICADA'],
  ['authorized', 'CONTACTO AUTORIZADO'],
  ['prepared', 'ABORDAGEM PREPARADA'],
  ['conversation', 'EM CONVERSA'],
  ['interested', 'CLIENTE INTERESSADO'],
  ['link_sent', 'LINK DO AGEXA ENVIADO'],
  ['ceo', 'ENTREGUE AO CEO'],
  ['account', 'CONTA CRIADA'],
  ['trial', 'TESTE GRATUITO ATIVO'],
  ['trial_ended', 'TESTE TERMINADO'],
  ['paying', 'CLIENTE PAGANTE'],
  ['lost', 'NÃO CONVERTIDO'],
] as const;
export type PipelineStage = (typeof PIPELINE)[number][0];
export type BusinessChannel = 'none' | 'website' | 'email' | 'whatsapp' | 'business_phone';
export interface CompanyInput {
  name: string;
  sector?: string;
  city?: string;
  province?: string;
  country?: string;
  website?: string;
  businessPage?: string;
  contactChannel?: BusinessChannel;
  businessContact?: string;
  needs?: string;
  nextAction?: string;
  usesAppointments?: boolean | null;
  organizationNeed?: boolean | null;
  hasSchedulingSystem?: boolean | null;
  sufficientInfo?: boolean | null;
}
export interface Company extends Required<
  Omit<
    CompanyInput,
    'usesAppointments' | 'organizationNeed' | 'hasSchedulingSystem' | 'sufficientInfo'
  >
> {
  id: string;
  sourceId: string;
  discoveredAt: string;
  updatedAt: string;
  recordMode: 'provided' | 'imported' | 'observed' | 'simulated';
  stage: PipelineStage;
  owner: EmployeeId;
  facts: {
    usesAppointments: boolean | null;
    organizationNeed: boolean | null;
    hasSchedulingSystem: boolean | null;
    sufficientInfo: boolean | null;
  };
  score: number | null;
  scoreReason: string | null;
  lastInteraction: string | null;
  eligibility: { allowed: boolean; channel: BusinessChannel; reason: string };
}
export interface BusinessSource {
  id: string;
  name: string;
  kind: 'manual' | 'csv' | 'website';
  url: string | null;
  termsUrl: string | null;
  permissionEvidence: string;
  attribution: string;
  enabled: boolean;
  termsReviewed: boolean;
  commercialReuseAllowed: boolean;
  createdAt: string;
}
export interface LeadQualification {
  id: string;
  companyId: string;
  taskId: string | null;
  mode: 'rules' | 'ai' | 'test';
  score: number | null;
  reason: string;
  criteria: unknown[];
  createdAt: string;
}
export interface ConsentRecord {
  id: string;
  companyId: string;
  channel: BusinessChannel;
  status: 'granted' | 'revoked' | 'denied';
  evidence: string;
  origin: string;
  createdAt: string;
}
export interface SalesDraft {
  id: string;
  companyId: string;
  employeeId: EmployeeId;
  kind: 'approach' | 'simulation' | 'objections' | 'invitation';
  body: string;
  version: number;
  status: 'proposed' | 'approved' | 'rejected';
  taskId: string | null;
  mode: 'rules' | 'ollama' | 'test' | 'manual';
  createdAt: string;
  internalOnly: true;
}
export interface SalesActivity {
  id: number;
  companyId: string | null;
  taskId: string | null;
  actor: string;
  action: string;
  detail: string;
  createdAt: string;
}
export interface HandoffPreparation {
  id: string;
  companyId: string;
  summary: string;
  officialUrl: string | null;
  status: 'prepared';
  createdAt: string;
}
export interface CommercialSettings {
  prioritySectors: string[];
  priorityCities: string[];
  qualificationThreshold: number;
  maxImportRows: number;
  maxResearchPerHour: number;
  maxCampaignLeads: number;
  contactPolicy: string;
}
export const DEFAULT_COMMERCIAL: CommercialSettings = {
  prioritySectors: [
    'barbearia',
    'salão',
    'clínica',
    'hotel',
    'pensão',
    'oficina',
    'estética',
    'consultoria',
  ],
  priorityCities: ['Beira', 'Maputo', 'Matola', 'Chimoio', 'Nampula'],
  qualificationThreshold: 60,
  maxImportRows: 200,
  maxResearchPerHour: 10,
  maxCampaignLeads: 3,
  contactPolicy:
    'Consentimento explícito por canal; dados empresariais públicos não autorizam publicidade.',
};
export interface CompanyDetail {
  company: Company;
  source: BusinessSource;
  qualifications: LeadQualification[];
  consents: ConsentRecord[];
  drafts: SalesDraft[];
  activities: SalesActivity[];
  handoffs: HandoffPreparation[];
}
export interface CrmBatch {
  id: string;
  sourceId: string;
  status: string;
  createdAt: string;
  result: Record<string, unknown> | null;
}
export interface CommercialOrder {
  id: string;
  goal: string;
  sourceId: string;
  sector: string;
  city: string;
  useAI: boolean;
  status: 'proposed' | 'running' | 'completed' | 'error' | 'cancelled';
  planTaskId: string;
  taskBudget: number;
  inferenceBudget: number;
  createdAt: string;
}
export interface CrmAnalytics {
  companies: number;
  qualified: number;
  highPriority: number;
  authorizedContacts: number;
  drafts: number;
  approvedDrafts: number;
  opportunities: number;
  simulatedCompanies: number;
  confirmedAccounts: number | null;
  confirmedTrials: number | null;
  confirmedPaying: number | null;
  sentMessages: null;
  revenue: null;
  stages: Record<string, number>;
  sources: { name: string; count: number }[];
  agents: { employeeId: string; completed: number; errors: number }[];
  provenance: 'Confirmações auditadas do CEO ou integração autenticada; consultar origem no Conversion Engine';
}
export interface CrmSnapshot {
  companies: Company[];
  totalCompanies: number;
  sources: BusinessSource[];
  drafts: SalesDraft[];
  settings: CommercialSettings;
  analytics: CrmAnalytics;
  batches: CrmBatch[];
  orders: CommercialOrder[];
}
