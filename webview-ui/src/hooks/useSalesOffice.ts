import { useCallback, useEffect, useState } from 'react';

import type { SalesSnapshot } from '../../../core/src/agexa.js';
import { isBrowserRuntime } from '../runtime.js';
import { serverToken } from '../transport/serverToken.js';

export function useSalesOffice() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [snapshot, setSnapshot] = useState<SalesSnapshot | null>(null);
  const [connection, setConnection] = useState('disconnected');
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  useEffect(() => {
    if (!isBrowserRuntime || import.meta.env.DEV) {
      setEnabled(false);
      return;
    }
    let disposed = false;
    void fetch('/api/agexa/enabled')
      .then((r) => r.json())
      .then((data: { enabled?: boolean }) => {
        if (!disposed) setEnabled(data.enabled === true);
      })
      .catch(() => {
        if (!disposed) setEnabled(false);
      });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (!enabled || !serverToken) return;
    const token = serverToken;
    let disposed = false;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    const connect = (): void => {
      if (disposed) return;
      setConnection('connecting');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(
        `${protocol}//${window.location.host}/api/agexa/events?token=${encodeURIComponent(token)}`,
      );
      socket.onmessage = (event) => {
        if (disposed) return;
        const data = JSON.parse(event.data as string) as SalesSnapshot;
        if (data.version !== 1) return;
        setSnapshot(data);
        setConnection('connected');
        setError('');
        retries = 0;
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (disposed) return;
        setConnection('reconnecting');
        timer = setTimeout(connect, Math.min(10000, 500 * 2 ** retries++));
      };
    };
    void fetch('/api/agexa/state', { headers: { Authorization: `Bearer ${serverToken}` } })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? 'Acesso administrativo recusado'
              : 'Não foi possível carregar o escritório',
          );
        const data = (await response.json()) as SalesSnapshot;
        if (!disposed) {
          setSnapshot(data);
          setUnauthorized(false);
          connect();
        }
      })
      .catch((e: Error) => {
        if (!disposed) {
          setError(e.message);
          setUnauthorized(true);
        }
      });
    return () => {
      disposed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [enabled]);
  const command = useCallback(async (route: string, body: unknown): Promise<void> => {
    setError('');
    try {
      const response = await fetch(`/api/agexa/${route}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serverToken ?? ''}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Operação recusada');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha de comunicação');
      throw e;
    }
  }, []);
  return {
    enabled,
    snapshot,
    connection,
    error,
    unauthorized,
    command,
    authenticated: !!serverToken,
  };
}
export type SalesOffice = ReturnType<typeof useSalesOffice>;
