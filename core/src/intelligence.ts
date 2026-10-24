import type { EmployeeId } from './agexa.js';

export const PLAN_ORDER: readonly EmployeeId[] = [
  'hunter',
  'atlas',
  'maya',
  'luna',
  'victor',
  'sophia',
  'orion',
];
export interface IntelligenceConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxContextChars: number;
  concurrency: number;
  maxTasks: number;
  maxInferences: number;
}
export const DEFAULT_INTELLIGENCE: IntelligenceConfig = {
  baseUrl: 'http://127.0.0.1:11434',
  model: '',
  timeoutMs: 60000,
  maxContextChars: 12000,
  concurrency: 1,
  maxTasks: 12,
  maxInferences: 10,
};
export interface AgexaKnowledge {
  signupUrl: string | null;
  trialAvailable: boolean;
  trialDays: 7;
  confirmedFeatures: string[];
  approvedPrices: string[];
  policies: string[];
}
export const EMPTY_KNOWLEDGE: AgexaKnowledge = {
  signupUrl: null,
  trialAvailable: false,
  trialDays: 7,
  confirmedFeatures: [],
  approvedPrices: [],
  policies: [],
};
export interface OperationalResult {
  summary: string;
  draft: string;
  observations: string[];
  nextActions: string[];
  plan?: { employeeId: EmployeeId; objective: string }[];
}
export interface OllamaStatus {
  reachable: boolean;
  connected: boolean;
  binaryDetected: boolean;
  model: string;
  models: string[];
  checkedAt: string | null;
  error: string | null;
  executionMode: 'ollama' | 'test';
}
export interface SalesWorkflow {
  id: string;
  goal: string;
  input: Record<string, unknown>;
  status: 'planning' | 'proposed' | 'running' | 'completed' | 'error' | 'cancelled';
  planTaskId: string;
  createdAt: string;
  approvedAt: string | null;
  taskBudget: number;
  inferenceBudget: number;
}
export interface AgentMemory {
  id: number;
  employeeId: EmployeeId | null;
  taskId: string | null;
  kind: 'decision' | 'summary';
  content: string;
  createdAt: string;
}
export interface IntelligenceSnapshot {
  config: IntelligenceConfig;
  status: OllamaStatus;
  knowledge: AgexaKnowledge;
  workflows: SalesWorkflow[];
  memories: AgentMemory[];
}
