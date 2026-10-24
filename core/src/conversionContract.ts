/** Portable domain contract shared by Office and the Base44 function. No SDK/Node runtime. */
import type { ConversionFact } from './conversion.js';
export const FACT_KINDS = [
  'account_created',
  'trial_started',
  'trial_extended',
  'trial_ended',
  'trial_cancelled',
  'payment_confirmed',
] as const;
export function isoDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error('Data ISO inválida');
  return new Date(value).toISOString();
}
export function opaque(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || !new RegExp(`^[A-Za-z0-9:_-]{1,${max}}$`).test(value))
    throw new Error(`${name}: usar identificador opaco, sem dados pessoais`);
  return value;
}
export function validateFact(input: unknown, now = Date.now()): ConversionFact {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Evento de conversão inválido');
  const f = input as ConversionFact;
  const allowed = [
    'eventId',
    'appId',
    'kind',
    'occurredAt',
    'accountId',
    'reference',
    'startAt',
    'endAt',
    'paymentId',
    'amountMinor',
    'currency',
    'verified',
    'evidence',
  ];
  if (Object.keys(f).some((k) => !allowed.includes(k)) || !FACT_KINDS.includes(f.kind))
    throw new Error('Contrato do evento não suportado');
  opaque(f.eventId, 'eventId');
  opaque(f.appId, 'appId');
  opaque(f.accountId, 'accountId');
  if (f.reference !== undefined) opaque(f.reference, 'reference');
  if (f.startAt !== undefined) isoDate(f.startAt);
  if (f.endAt !== undefined) isoDate(f.endAt);
  if (f.paymentId !== undefined) opaque(f.paymentId, 'paymentId');
  if (f.verified !== undefined && typeof f.verified !== 'boolean')
    throw new Error('Confirmação inválida');
  if (f.amountMinor !== undefined && (!Number.isSafeInteger(f.amountMinor) || f.amountMinor <= 0))
    throw new Error('Pagamento: montante inválido');
  if (f.currency !== undefined && !/^[A-Z]{3}$/.test(f.currency))
    throw new Error('Pagamento: moeda inválida');
  const occurredAt = isoDate(f.occurredAt);
  if (Date.parse(occurredAt) > now + 60000) throw new Error('Evento com data futura');
  if (typeof f.evidence !== 'string' || !f.evidence.trim() || f.evidence.length > 1000)
    throw new Error('Evidência da confirmação obrigatória');
  if (f.kind === 'trial_started' || f.kind === 'trial_extended') {
    const a = isoDate(f.startAt),
      b = isoDate(f.endAt);
    if (
      Date.parse(b) <= Date.parse(a) ||
      Date.parse(b) - Date.parse(a) > 366 * 86400000 ||
      Date.parse(a) > now + 60000
    )
      throw new Error('Datas efetivas do teste inválidas');
  }
  if (f.kind === 'payment_confirmed') {
    if (
      f.verified !== true ||
      !f.paymentId ||
      !Number.isSafeInteger(f.amountMinor) ||
      f.amountMinor! <= 0 ||
      !f.currency ||
      !/^[A-Z]{3}$/.test(f.currency)
    )
      throw new Error(
        'Pagamento exige confirmação independente, recibo, montante em unidades mínimas e moeda',
      );
    opaque(f.paymentId, 'paymentId');
  }
  return { ...f, occurredAt };
}
