import type { EmployeeId } from './agexa.js';

export type ReadinessState = 'VALIDADO' | 'PENDENTE' | 'ERRO';
export type EvidenceMode = 'technical' | 'real' | 'manual' | 'simulated';
export interface ReadinessCheck {
  id: string;
  name: string;
  state: ReadinessState;
  mode: EvidenceMode;
  checkedAt: string | null;
  evidence: string;
  blocker: string | null;
  nextAction: string;
}
export interface OfferVerification {
  registrationEvidence: string;
  startsWhen: string;
  expiryBehaviour: string;
  paymentRequired: boolean;
  includedFeatures: string;
  confirmed: true;
}
export interface EmployeeProof {
  employeeId: EmployeeId;
  taskId: string | null;
  status: string;
  model: string | null;
  durationMs: number | null;
  at: string | null;
  mode: EvidenceMode;
  error: string | null;
}
export interface ReadinessReport {
  checkedAt: string;
  pilotReady: boolean;
  scope: string;
  checks: ReadinessCheck[];
  employees: EmployeeProof[];
  offer: {
    valid: boolean;
    verifiedAt: string | null;
    mode: EvidenceMode;
    evidence: OfferVerification | null;
  };
  history: { at: string; validated: number; pending: number; errors: number }[];
}
