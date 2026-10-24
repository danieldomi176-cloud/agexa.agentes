import { randomUUID } from 'node:crypto';

import { afterEach, expect, it, vi } from 'vitest';

import type { CeoBrowserRequest } from '../../core/src/ceoBridge.js';
import { createOfficeClient } from '../../integrations/base44/officeClient.js';

afterEach(() => vi.useRealTimers());
it('calls only the authenticated Base44 function, correlates replies and does not accept browser actor fields', async () => {
  const invoke = vi.fn(async (_name: string, body: CeoBrowserRequest) => ({
    data: { requestId: body.requestId, ok: true, status: 200, result: { real: 'fixture' } },
  }));
  const client = createOfficeClient(invoke);
  expect(await client.read('office.state')).toEqual({ real: 'fixture' });
  expect(invoke.mock.calls[0][0]).toBe('agexaOfficeAdmin');
  expect(Object.keys(invoke.mock.calls[0][1])).toEqual(['operation', 'input', 'requestId']);
  await expect(
    client.request({ ...invoke.mock.calls[0][1], actorId: 'impersonation' } as never),
  ).rejects.toThrow();
  expect(() => client.read('operations.stop')).toThrow();
});
it('never retries a control after a lost response and preserves the caller request ID', async () => {
  const invoke = vi.fn(async (_name: string, _body: CeoBrowserRequest) => {
    throw Error('Network');
  });
  const client = createOfficeClient(invoke),
    request = {
      operation: 'operations.stop' as const,
      input: {},
      confirm: true,
      requestId: randomUUID(),
    };
  await expect(client.request(request)).rejects.toThrow();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0][1]).toEqual(request);
});
it('polls sequentially, skips hidden pages, backs off on errors and stops cleanly', async () => {
  vi.useFakeTimers();
  let visible = false;
  const invoke = vi.fn(async (_name: string, body: CeoBrowserRequest) => ({
    data: { requestId: body.requestId, ok: true, status: 200, result: { real: true } },
  }));
  const client = createOfficeClient(invoke),
    update = vi.fn(),
    error = vi.fn();
  const stop = client.watch(update, error, () => visible);
  await vi.advanceTimersByTimeAsync(5000);
  expect(invoke).not.toHaveBeenCalled();
  visible = true;
  await vi.advanceTimersByTimeAsync(5000);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledTimes(1);
  invoke.mockRejectedValueOnce(Error('Unavailable'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(error).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(29000);
  expect(invoke).toHaveBeenCalledTimes(2);
  stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(invoke).toHaveBeenCalledTimes(2);
});
it('ignores in-flight results after disposal and rejects mismatched response identities', async () => {
  let resolve!: (value: { data: unknown }) => void;
  const invoke = vi.fn(
    () =>
      new Promise<{ data: unknown }>((r) => {
        resolve = r;
      }),
  );
  const client = createOfficeClient(invoke),
    update = vi.fn(),
    error = vi.fn();
  const stop = client.watch(update, error);
  stop();
  resolve({ data: { ok: true, status: 200, requestId: 'wrong', result: {} } });
  await Promise.resolve();
  await Promise.resolve();
  expect(update).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});
