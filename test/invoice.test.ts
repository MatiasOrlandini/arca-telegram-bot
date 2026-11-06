import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVoucher, parseAmount, parseDate, parseDocument, today } from '../src/invoice.js';
import { advance, summary } from '../src/wizard.js';
import { invoiceData } from '../src/pdf.js';
import { draft, record } from './fixtures.js';

test('importes exactos en centavos y rechazo de importes ambiguos', () => {
  assert.equal(parseAmount('15000,50'), 1500050); assert.equal(parseAmount('0.01'), 1);
  for (const input of ['1.000', '1.000,00', '-1', '0', '1e3', '12,345']) assert.throws(() => parseAmount(input));
});
test('fechas válidas y día argentino', () => {
  assert.equal(parseDate('2024-02-29'), '20240229');
  assert.throws(() => parseDate('2025-02-29')); assert.throws(() => parseDate('2026-13-01'));
  assert.equal(today(new Date('2026-10-02T01:00:00Z')), '20261001');
});
test('CUIT y DNI válidos; factura C sin IVA', () => {
  assert.equal(parseDocument('20-12345678-6', 80), 20123456786);
  assert.throws(() => parseDocument('20-12345678-7', 80));
  const p = buildVoucher(draft(), 1, 11);
  assert.equal(p.CbteTipo, 11); assert.equal(p.DocTipo, 96); assert.equal(p.ImpIVA, 0);
  assert.equal(p.ImpNeto, p.ImpTotal); assert.equal(p.CondicionIVAReceptorId, 5);
  assert.equal(p.FchServDesde, draft().serviceFrom); assert.equal(p.Iva, undefined);
});
test('wizard completo con validación del período', () => {
  const r = record(); r.draft = {}; r.step = 'documentType';
  for (const value of ['DNI', '30123456', 'Cliente', 'Domicilio', '5', 'Servicio', '100,25', '3', '2', '2026-10-01'])
    advance(r, value, [{ id: 5, desc: 'Consumidor Final' }]);
  assert.throws(() => advance(r, '2026-09-30', [])); assert.equal(r.step, 'serviceTo');
  advance(r, '2026-10-02', []); advance(r, '2099-01-01', []);
  assert.equal(r.step, 'confirm'); assert.equal(r.draft.cents, 10025);
  assert.equal(r.draft.paymentMethod, 'Transferencia bancaria');
  assert.match(summary(r, 1, false), /Forma de pago: Transferencia bancaria/);
});

test('forma de pago rechaza opciones inválidas y continúa para productos', () => {
  const r = record(); r.step = 'paymentMethod';
  assert.throws(() => advance(r, '9', []));
  assert.equal(r.step, 'paymentMethod'); assert.equal(r.draft.paymentMethod, undefined);
  advance(r, 'Efectivo', []); advance(r, '1', []);
  assert.equal(r.step, 'confirm'); assert.equal(r.draft.paymentMethod, 'Efectivo');
});
test('PDF contiene datos del comprobante autorizado y no admite borradores', () => {
  const r = record();
  const config = { point: 1, issuer: { cuit: '20123456786', razonSocial: 'EMISOR DE PRUEBA', domicilioComercial: 'Prueba 123', condicionIva: 'Responsable Monotributo', iibb: 'Exento', fechaInicioActividades: '20260101' } };
  assert.throws(() => invoiceData(r, config));
  r.status = 'authorized'; r.payload = buildVoucher(draft(), 1, 11); r.cae = '12345678901234'; r.expiration = '20261012';
  const data = invoiceData(r, config);
  assert.equal(data.cae, r.cae); assert.equal(data.cbteDesde, 11); assert.equal(data.cbteLetra, 'C');
  assert.equal(data.importeTotal, 15000.5); assert.equal(data.receptor.documentoTipo, 'DNI');
  assert.equal(data.condicionVenta, 'Contado');
  r.draft.paymentMethod = 'Transferencia bancaria';
  assert.equal(invoiceData(r, config).condicionVenta, 'Transferencia bancaria');
});
