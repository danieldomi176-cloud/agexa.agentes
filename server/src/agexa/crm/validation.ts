import * as net from 'node:net';

import type { CompanyInput } from '../../../../core/src/crm.js';
import { CrmError } from './error.js';

export const normalize = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
export function publicWebsite(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CrmError('URL inválida');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443') ||
    net.isIP(host) ||
    !host.includes('.') ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
    host.endsWith('.localhost') ||
    value.length > 1000
  )
    throw new CrmError(
      'URL insegura: usar um website público HTTPS, sem credenciais, IP literal ou porta alternativa',
    );
  return url;
}
export function validateCompany(value: CompanyInput): CompanyInput {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 200
  )
    throw new CrmError('Nome empresarial obrigatório (máximo 200 caracteres)');
  const fields = [
    'sector',
    'city',
    'province',
    'country',
    'businessContact',
    'needs',
    'nextAction',
  ] as const;
  for (const key of fields)
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'string' || value[key]!.length > (key === 'needs' ? 2000 : 500))
    )
      throw new CrmError(`Campo empresarial inválido: ${key}`);
  for (const key of ['website', 'businessPage'] as const)
    if (value[key]) publicWebsite(value[key]!);
  if (
    value.contactChannel &&
    !['none', 'website', 'email', 'whatsapp', 'business_phone'].includes(value.contactChannel)
  )
    throw new CrmError('Canal comercial inválido');
  for (const key of [
    'usesAppointments',
    'organizationNeed',
    'hasSchedulingSystem',
    'sufficientInfo',
  ] as const)
    if (value[key] !== undefined && value[key] !== null && typeof value[key] !== 'boolean')
      throw new CrmError(`Facto inválido: ${key}`);
  return value;
}
/** RFC 4180 subset with quoted commas/newlines and explicit resource limits. */
export function parseCompanyCsv(csv: string, maxRows = 200): CompanyInput[] {
  if (typeof csv !== 'string' || Buffer.byteLength(csv) > 48000)
    throw new CrmError('CSV limitado a 48 KB');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let endedQuote = false;
  const addCell = (): void => {
    row.push(cell);
    cell = '';
    endedQuote = false;
    if (row.length > 30) throw new CrmError('CSV com demasiadas colunas');
  };
  const addRow = (): void => {
    addCell();
    if (row.some((s) => s.trim())) rows.push(row);
    row = [];
    if (rows.length > maxRows + 1) throw new CrmError('CSV excede o limite de empresas');
  };
  const text = csv.replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    if (quoted) {
      if (ch === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          endedQuote = true;
        }
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      if (cell || endedQuote) throw new CrmError('Aspas CSV inválidas');
      quoted = true;
      continue;
    }
    if (ch === ',') {
      addCell();
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[index + 1] === '\n') index++;
      addRow();
      continue;
    }
    if (endedQuote && !/\s/.test(ch)) throw new CrmError('Texto depois de aspas CSV');
    cell += ch;
  }
  if (quoted) throw new CrmError('CSV com aspas por fechar');
  if (cell || row.length) addRow();
  if (rows.length < 2) throw new CrmError('CSV deve conter cabeçalho e empresas');
  const aliases: Record<string, keyof CompanyInput> = {
    name: 'name',
    nome: 'name',
    empresa: 'name',
    nomeempresarial: 'name',
    sector: 'sector',
    setor: 'sector',
    city: 'city',
    cidade: 'city',
    province: 'province',
    provincia: 'province',
    country: 'country',
    pais: 'country',
    website: 'website',
    businesspage: 'businessPage',
    paginaempresarial: 'businessPage',
    contactchannel: 'contactChannel',
    canal: 'contactChannel',
    businesscontact: 'businessContact',
    contactoempresarial: 'businessContact',
    needs: 'needs',
    necessidades: 'needs',
    nextaction: 'nextAction',
    proximaacao: 'nextAction',
    usesappointments: 'usesAppointments',
    organizationneed: 'organizationNeed',
    hasschedulingsystem: 'hasSchedulingSystem',
    sufficientinfo: 'sufficientInfo',
  };
  const header = rows.shift()!.map((name) => aliases[normalize(name).replace(/ /g, '')]);
  if (
    header.some((name) => !name) ||
    !header.includes('name') ||
    new Set(header).size !== header.length
  )
    throw new CrmError('Cabeçalhos desconhecidos, duplicados ou sem nome empresarial');
  return rows.map((values, index) => {
    if (values.length !== header.length)
      throw new CrmError(`Número de colunas inválido na linha ${index + 2}`);
    const company: Record<string, unknown> = {};
    header.forEach((key, col) => {
      const value = values[col].trim();
      if (!value) return;
      if (
        ['usesAppointments', 'organizationNeed', 'hasSchedulingSystem', 'sufficientInfo'].includes(
          key,
        )
      ) {
        if (!['true', 'false', 'sim', 'não', 'nao'].includes(value.toLowerCase()))
          throw new CrmError(`Booleano inválido na linha ${index + 2}`);
        company[key] = ['true', 'sim'].includes(value.toLowerCase());
      } else company[key] = value;
    });
    return validateCompany(company as unknown as CompanyInput);
  });
}
export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
