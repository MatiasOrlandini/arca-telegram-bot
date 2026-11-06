import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, fixedServiceDraft } from '../src/wizard.js';
import { buildVoucher } from '../src/invoice.js';
import { record } from './fixtures.js';

const settings = { cuit: '20123456786', name: 'EMPRESA DE PRUEBA', address: 'Calle 123', ivaId: '1',
  description: 'Servicios mensuales de informática', paymentMethod: 'Transferencia bancaria' };
const options = [{ id: 1, desc: 'IVA Responsable Inscripto' }];

test('factura fija solo pide importe y fechas; conserva receptor y servicio en la request', () => {
  const r = record(); r.draft = fixedServiceDraft(settings, options); r.step = 'amount';
  advance(r, '15000,50', []); assert.equal(r.step, 'serviceFrom');
  advance(r, '2026-09-01', []); advance(r, '2026-09-30', []); advance(r, '2099-01-01', []);
  assert.equal(r.step, 'confirm');
  const payload = buildVoucher(r.draft as Parameters<typeof buildVoucher>[0], 2, 1);
  assert.equal(payload.CbteTipo, 11); assert.equal(payload.Concepto, 2);
  assert.equal(payload.DocTipo, 80); assert.equal(payload.DocNro, 20123456786);
  assert.equal(payload.CondicionIVAReceptorId, 1); assert.equal(payload.ImpTotal, 15000.5);
  assert.equal(r.draft.description, settings.description); assert.equal(r.draft.paymentMethod, settings.paymentMethod);
});

test('configuración fija inválida se rechaza antes de crear un borrador', () => {
  assert.throws(() => fixedServiceDraft(undefined, options), /Configurá/);
  for (const invalid of [ { cuit: '' }, { cuit: '20123456787' }, { ivaId: '99' }, { description: '' },
    { description: 'a'.repeat(501) }, { name: 'a\nb' }, { paymentMethod: 'Bitcoin' } ])
    assert.throws(() => fixedServiceDraft({ ...settings, ...invalid }, options));
});
