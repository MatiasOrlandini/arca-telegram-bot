import { mkdirSync, writeFileSync } from 'node:fs';
import { generateInvoicePdf, invoiceData } from '../src/pdf.js';
import { buildVoucher, today } from '../src/invoice.js';
import { draft, record } from '../test/fixtures.js';

const r = record(); r.status = 'authorized';
r.draft = { ...draft(), voucherType: 13, description: 'Anulación total por cancelación del servicio de prueba.',
  paymentMethod: 'Transferencia bancaria',
  associatedVoucher: { Tipo: 11, PtoVta: 1, Nro: 55, Cuit: '20123456786', CbteFch: today() } };
r.payload = buildVoucher(r.draft as ReturnType<typeof draft>, 1, 1);
r.cae = '12345678901235'; r.expiration = '20261020';
const config = { point: 1, issuer: { cuit: '20123456786', razonSocial: 'EMISOR DE PRUEBA', domicilioComercial: 'Av. de Prueba 1234 - Buenos Aires', condicionIva: 'Responsable Monotributo', iibb: 'Exento', fechaInicioActividades: '20260101' } };
const buffer = await generateInvoicePdf(invoiceData(r, config), false);
mkdirSync('output/pdf', { recursive: true });
writeFileSync('output/pdf/nota-credito-c-prueba.pdf', buffer);
console.log('PDF de nota de crédito generado con datos ficticios, sin contactar ARCA.');
