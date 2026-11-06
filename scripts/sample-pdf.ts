import { mkdirSync, writeFileSync } from 'node:fs';
import { generateInvoicePdf, invoiceData } from '../src/pdf.js';
import { buildVoucher } from '../src/invoice.js';
import { draft, record } from '../test/fixtures.js';

const r = record(); r.status = 'authorized'; r.payload = buildVoucher(draft(), 1, 11);
r.cae = '12345678901234'; r.expiration = '20261012';
const config = { point: 1, issuer: { cuit: '20123456786', razonSocial: 'EMISOR DE PRUEBA', domicilioComercial: 'Av. de Prueba 1234 - Buenos Aires', condicionIva: 'Responsable Monotributo', iibb: 'Exento', fechaInicioActividades: '20260101' } };
const buffer = await generateInvoicePdf(invoiceData(r, config), false);
mkdirSync('output/pdf', { recursive: true });
writeFileSync('output/pdf/factura-c-prueba.pdf', buffer);
console.log('PDF de prueba generado (datos ficticios).');
