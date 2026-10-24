import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ConversionFact } from '../../../../core/src/conversion.js';
import { CrmError } from '../crm/error.js';
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
    throw new CrmError('Data ISO inválida');
  return new Date(value).toISOString();
}
export function opaque(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || !new RegExp(`^[A-Za-z0-9:_-]{1,${max}}$`).test(value))
    throw new CrmError(`${name}: usar identificador opaco, sem dados pessoais`);
  return value;
}
export function validateFact(input: unknown): ConversionFact {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new CrmError('Evento de conversão inválido');
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
    throw new CrmError('Contrato do evento não suportado');
  opaque(f.eventId, 'eventId');
  opaque(f.appId, 'appId');
  opaque(f.accountId, 'accountId');
  if (f.reference) opaque(f.reference, 'reference');
  const occurredAt = isoDate(f.occurredAt);
  if (Date.parse(occurredAt) > Date.now() + 60000) throw new CrmError('Evento com data futura');
  if (typeof f.evidence !== 'string' || !f.evidence.trim() || f.evidence.length > 1000)
    throw new CrmError('Evidência da confirmação obrigatória');
  if (f.kind === 'trial_started' || f.kind === 'trial_extended') {
    const a = isoDate(f.startAt),
      b = isoDate(f.endAt);
    if (
      Date.parse(b) <= Date.parse(a) ||
      Date.parse(b) - Date.parse(a) > 366 * 86400000 ||
      Date.parse(a) > Date.now() + 60000
    )
      throw new CrmError('Datas efetivas do teste inválidas');
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
      throw new CrmError(
        'Pagamento exige confirmação independente, recibo, montante em unidades mínimas e moeda',
      );
    opaque(f.paymentId, 'paymentId');
  }
  return { ...f, occurredAt };
}
export function sign(secret: string, stamp: string, nonce: string, body: string): string {
  return createHmac('sha256', secret)
    .update(stamp + '\n' + nonce + '\n' + body)
    .digest('hex');
}
export function verify(
  secret: string,
  stamp: string,
  nonce: string,
  body: string,
  signature: string,
): void {
  if (
    !/^\d{10,13}$/.test(stamp) ||
    Math.abs(Date.now() - Number(stamp)) > 300000 ||
    !/^[-a-zA-Z0-9]{20,100}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    throw new CrmError('Assinatura ou timestamp da integração inválido', 401);
  const expected = Buffer.from(sign(secret, stamp, nonce, body), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
    throw new CrmError('Autenticação da integração recusada', 401);
}
