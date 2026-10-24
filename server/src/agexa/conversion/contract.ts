import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ConversionFact } from '../../../../core/src/conversion.js';
import {
  FACT_KINDS,
  isoDate as parseDate,
  opaque as parseOpaque,
  validateFact as parseFact,
} from '../../../../core/src/conversionContract.js';
import { CrmError } from '../crm/error.js';
export { FACT_KINDS };
function domain<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new CrmError(error instanceof Error ? error.message : 'Contrato inválido');
  }
}
export function isoDate(value: unknown): string {
  return domain(() => parseDate(value));
}
export function opaque(value: unknown, name: string, max = 200): string {
  return domain(() => parseOpaque(value, name, max));
}
export function validateFact(input: unknown): ConversionFact {
  return domain(() => parseFact(input));
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
