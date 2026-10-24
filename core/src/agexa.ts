/** Commercial contracts are independent of the coding-provider protocol. */
export const EMPLOYEES = [
  {
    id: 'nexus',
    name: 'NEXUS',
    role: 'Diretor Comercial IA',
    area: 'Direção',
    palette: 0,
    hue: 275,
  },
  { id: 'hunter', name: 'HUNTER', role: 'Prospeção', area: 'Prospeção', palette: 1, hue: 0 },
  { id: 'atlas', name: 'ATLAS', role: 'Qualificação', area: 'Análise', palette: 2, hue: 0 },
  { id: 'maya', name: 'MAYA', role: 'Marketing', area: 'Marketing', palette: 3, hue: 0 },
  { id: 'luna', name: 'LUNA', role: 'Vendas', area: 'Vendas', palette: 4, hue: 0 },
  { id: 'victor', name: 'VICTOR', role: 'Negociação', area: 'Vendas', palette: 5, hue: 0 },
  { id: 'sophia', name: 'SOPHIA', role: 'Conversão', area: 'Vendas', palette: 0, hue: 130 },
  { id: 'orion', name: 'ORION', role: 'Análise Comercial', area: 'Análise', palette: 1, hue: 210 },
] as const;
export type EmployeeId = (typeof EMPLOYEES)[number]['id'];
export const SALES_OBJECTIVE =
  'Encontrar oportunidades → conquistar interesse → explicar o Agexa → apresentar 7 dias grátis apenas após confirmação da oferta → enviar link confirmado após aceitação → transferir ao CEO';
export type TaskKind = 'prepare_brief' | 'qualify_company' | 'sales_report' | 'ai_request';
export type TaskStatus =
  'queued' | 'running' | 'awaiting_approval' | 'blocked' | 'completed' | 'error' | 'cancelled';
export type EmployeeStatus =
  'paused' | 'available' | 'working' | 'awaiting_approval' | 'blocked' | 'error';
export interface SalesTask {
  id: string;
  employeeId: EmployeeId;
  kind: TaskKind;
  objective: string;
  input: Record<string, unknown>;
  status: TaskStatus;
  priority: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  parentId: string | null;
  approvedAt: string | null;
}
export interface SalesEmployee {
  id: EmployeeId;
  name: string;
  role: string;
  area: string;
  palette: number;
  hue: number;
  characterId: number;
  seatId: string;
  enabled: boolean;
  status: EmployeeStatus;
  currentTask: string | null;
  completed: number;
  errors: number;
  queued: number;
}
export interface SalesEvent {
  id: number;
  at: string;
  employeeId: EmployeeId | null;
  taskId: string | null;
  action: string;
  detail: string;
}
export interface SalesSnapshot {
  version: 1;
  suspended: boolean;
  inference: { connected: boolean; provider: string; message: string };
  employees: SalesEmployee[];
  tasks: SalesTask[];
  events: SalesEvent[];
  objective: string;
}
export interface CreateSalesTask {
  employeeId: EmployeeId;
  kind: TaskKind;
  objective: string;
  input: Record<string, unknown>;
  priority?: number;
  requiresApproval?: boolean;
}
export interface InferenceAdapter {
  readonly name: string;
  readonly connected: boolean;
  run(
    task: SalesTask,
    context: { signal: AbortSignal; objective: string },
  ): Promise<Record<string, unknown>>;
}
export const salesCharacterId = (index: number): number => -100 - index;
