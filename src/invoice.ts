import type { ElectronicBillingService } from '@arcasdk/core';
import { UserError as Error } from './errors.js';
export type IVoucher = Parameters<ElectronicBillingService['createVoucher']>[0];

export interface Draft {
  documentType: number;
  documentNumber: number;
  name: string;
  address: string;
  ivaId: number;
  ivaLabel: string;
  description: string;
  cents: number;
  concept: number;
  date: string;
  serviceFrom?: string;
  serviceTo?: string;
  paymentDue?: string;
  paymentMethod?: string;
  fixedService?: boolean;
  voucherType?: 11 | 13;
  associatedVoucher?: NonNullable<IVoucher['CbtesAsoc']>[number];
}

export function today(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day'].map(k => parts.find(p => p.type === k)!.value).join('');
}

export function parseDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) throw new Error('Usá una fecha con formato AAAA-MM-DD.');
  const [, y, m, d] = match;
  const date = new Date(`${y}-${m}-${d}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== `${y}-${m}-${d}`)
    throw new Error('La fecha no existe.');
  return y + m + d;
}

export function parseAmount(value: string): number {
  // No separators of thousands: an ambiguous amount must never reach ARCA.
  const text = value.trim();
  if (!/^\d{1,12}([.,]\d{1,2})?$/.test(text))
    throw new Error('Ingresá el total sin separador de miles, por ejemplo 15000,50.');
  const [whole, decimal = ''] = text.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('El importe debe ser mayor a cero.');
  return cents;
}

export function validCuit(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const sum = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2].reduce((s, weight, i) => s + weight * digits[i], 0);
  const raw = 11 - sum % 11;
  return digits[10] === (raw === 11 ? 0 : raw === 10 ? 9 : raw);
}

export function parseDocument(value: string, type: number): number {
  const text = value.trim().replace(/[- ]/g, '');
  if (type === 80 && !validCuit(text)) throw new Error('CUIT inválido: revisá los 11 dígitos.');
  if (type === 96 && (!/^\d{7,8}$/.test(text) || Number(text) === 0))
    throw new Error('El DNI debe tener 7 u 8 dígitos.');
  if (![80, 96].includes(type)) throw new Error('Tipo de documento inválido.');
  return Number(text);
}

export function buildVoucher(d: Draft, point: number, number: number): IVoucher {
  const type = d.voucherType ?? 11;
  if (![11, 13].includes(type) || (type === 13 && (!d.associatedVoucher ||
      d.associatedVoucher.Tipo !== 11 || !validCuit(d.associatedVoucher.Cuit) ||
      !Number.isInteger(d.associatedVoucher.PtoVta) || d.associatedVoucher.PtoVta < 1 ||
      !Number.isInteger(d.associatedVoucher.Nro) || d.associatedVoucher.Nro < 1)))
    throw new Error('La nota de crédito debe asociarse a una Factura C autorizada.');
  if (![80, 96].includes(d.documentType) || !d.name || !d.address || !d.description ||
      !Number.isSafeInteger(d.cents) || d.cents <= 0 || ![1, 2, 3].includes(d.concept) || !d.ivaId)
    throw new Error('El borrador está incompleto.');
  parseDocument(String(d.documentNumber), d.documentType);
  if (d.concept !== 1 && (!d.serviceFrom || !d.serviceTo || !d.paymentDue ||
      d.serviceFrom > d.serviceTo || d.paymentDue < d.date))
    throw new Error('Revisá el período del servicio y el vencimiento de pago.');
  return {
    CantReg: 1, PtoVta: point, CbteTipo: type, Concepto: d.concept,
    DocTipo: d.documentType, DocNro: d.documentNumber, CondicionIVAReceptorId: d.ivaId,
    CbteDesde: number, CbteHasta: number, CbteFch: d.date,
    ImpTotal: d.cents / 100, ImpNeto: d.cents / 100,
    ImpIVA: 0, ImpTotConc: 0, ImpOpEx: 0, ImpTrib: 0, MonId: 'PES', MonCotiz: 1,
    ...(d.concept !== 1 ? { FchServDesde: d.serviceFrom, FchServHasta: d.serviceTo, FchVtoPago: d.paymentDue } : {}),
    ...(type === 13 ? { CbtesAsoc: [d.associatedVoucher!] } : {}),
  };
}

export const money = (cents: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(cents / 100);
export const displayDate = (value: string) => `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
