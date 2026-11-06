import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDate, validCuit } from './invoice.js';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta configurar ${name} en .env.`);
  return value;
}

export function loadConfig() {
  const optional = (name: string) => process.env[name]?.trim() ?? '';
  const startDate = optional('EMISOR_INICIO_ACTIVIDADES');
  const cuit = required('ARCA_CUIT').replace(/-/g, '');
  if (!validCuit(cuit)) throw new Error('ARCA_CUIT no es un CUIT válido.');
  const environment = process.env.ARCA_ENV ?? 'homologacion';
  if (!['homologacion', 'produccion'].includes(environment)) throw new Error('ARCA_ENV debe ser homologacion o produccion.');
  const point = Number(required('ARCA_PUNTO_VENTA'));
  if (!Number.isInteger(point) || point < 1 || point > 99999) throw new Error('Punto de venta inválido.');
  const ids = required('TELEGRAM_ALLOWED_USER_IDS').split(',').map(v => Number(v.trim()));
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('IDs de Telegram inválidos.');
  const token = required('TELEGRAM_BOT_TOKEN');
  if (!/^\d+:[\w-]+$/.test(token)) throw new Error('Token de Telegram inválido.');
  return {
    databaseUrl: required('DATABASE_URL'),
    databaseSsl: process.env.DATABASE_SSL === 'true',
    context: `${environment}:${cuit}:${point}`,
    token, allowedUsers: new Set(ids), cuit, point, production: environment === 'produccion',
    dataDir: resolve(process.env.DATA_DIR ?? 'data', environment, cuit, String(point)),
    cert: readFileSync(resolve(required('ARCA_CERT_PATH')), 'utf8'),
    key: readFileSync(resolve(required('ARCA_KEY_PATH')), 'utf8'),
    fixedInvoice: {
      cuit: optional('RECEPTOR_CUIT'), name: optional('RECEPTOR_RAZON_SOCIAL'),
      address: optional('RECEPTOR_DOMICILIO'), ivaId: optional('RECEPTOR_IVA_ID'),
      description: optional('FACTURA_FIJA_DESCRIPCION'),
      paymentMethod: optional('FACTURA_FIJA_FORMA_PAGO') || 'Contado',
    },
    issuer: {
      cuit, razonSocial: optional('EMISOR_RAZON_SOCIAL'), domicilioComercial: optional('EMISOR_DOMICILIO'),
      condicionIva: 'Responsable Monotributo', iibb: optional('EMISOR_IIBB'),
      fechaInicioActividades: startDate ? parseDate(startDate) : '',
    },
  };
}
export type Config = ReturnType<typeof loadConfig>;
