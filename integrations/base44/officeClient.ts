/** Browser adapter: ONLY Base44's authenticated function invocation, no Office URL or key. */
import type { CeoBrowserRequest, CeoInput, CeoOperation } from '../../core/src/ceoBridge.js';
import { CEO_OPERATIONS, parseCeoRequest } from '../../core/src/ceoBridge.js';

export interface OfficeInvoke {
  (name: string, body: CeoBrowserRequest): Promise<{ data: unknown }>;
}
export class OfficeRequestError extends Error {
  constructor(
    readonly requestId: string,
    readonly status: number,
  ) {
    super('Pedido Office falhou; consultar o estado e a auditoria antes de repetir ações.');
  }
}
export function createOfficeClient(invoke: OfficeInvoke) {
  async function request<T>(body: CeoBrowserRequest): Promise<T> {
    parseCeoRequest(body, false);
    const response = await invoke('agexaOfficeAdmin', body);
    const value = response.data as {
      ok?: boolean;
      status?: number;
      requestId?: string;
      result?: T;
    } | null;
    if (
      !value ||
      value.ok !== true ||
      value.requestId !== body.requestId ||
      typeof value.status !== 'number' ||
      value.status < 200 ||
      value.status >= 300
    )
      throw new OfficeRequestError(body.requestId, value?.status ?? 502);
    return value.result as T;
  }
  function read<T>(operation: CeoOperation, input: CeoInput = {}): Promise<T> {
    if (CEO_OPERATIONS[operation][0] !== 'read') throw Error('Read capability required');
    return request<T>({ operation, input, requestId: crypto.randomUUID() });
  }
  function watch<T>(
    onState: (state: T) => void,
    onError: (error: unknown) => void,
    isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  ): () => void {
    let active = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      if (!active) return;
      let delay = 5000;
      if (isVisible()) {
        try {
          const value = await read<T>('office.state');
          if (active) onState(value);
        } catch (error) {
          if (active) onError(error);
          delay = 30000;
        }
      }
      if (active) timer = setTimeout(() => void tick(), delay);
    };
    void tick();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }
  return { request, read, watch };
}
