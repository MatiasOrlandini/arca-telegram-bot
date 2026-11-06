import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Billing, type Gateway } from '../src/billing.js';
import { buildVoucher } from '../src/invoice.js';
import { advance, summary } from '../src/wizard.js';
import { invoiceData } from '../src/pdf.js';
import { arcaWebTemplate } from '../src/arca-template.js';
import { MemoryStore, record, draft } from './fixtures.js';

const issuer = { cuit: '20123456786', razonSocial: 'EMISOR', domicilioComercial: 'Prueba',
  condicionIva: 'Responsable Monotributo', iibb: 'Exento', fechaInicioActividades: '20260101' };
async function setup() {
  const store = new MemoryStore(); const source = record();
  source.status = 'authorized'; source.payload = buildVoucher(draft(), 1, 55);
  source.cae = '12345678901234'; source.issuer = issuer; await store.save(source);
  const calls: number[] = [];
  const api: Gateway = {
    getServerStatus: async () => ({ appServer: 'OK', dbServer: 'OK', authServer: 'OK' }),
    getLastVoucher: async (point, type) => { calls.push(type); return { ptoVta: point, cbteTipo: type, cbteNro: 0 }; },
    createVoucher: async p => {
      assert.equal(p.CbteTipo, 13); assert.equal(p.CbteDesde, 1);
      assert.deepEqual(p.CbtesAsoc, [{ Tipo: 11, PtoVta: 1, Nro: 55, Cuit: issuer.cuit, CbteFch: source.payload!.CbteFch }]);
      assert.equal(p.ImpTotal, source.payload!.ImpTotal);
      return { cae: '12345678901235', caeFchVto: '20261020', response: { FeDetResp: { FECAEDetResponse: [{ Resultado: 'A' }] } } };
    },
    getVoucherInfo: async () => null,
  };
  return { store, source, api, calls, billing: new Billing(api, store, 1) };
}

test('nota total conserva receptor, asocia factura, pide motivo, usa tipo 13 y genera datos PDF correctos', async () => {
  const { billing, source, store, calls } = await setup();
  const r = await billing.prepareCredit(source.id, 123);
  assert.equal(r.step, 'creditReason'); assert.equal(r.draft.documentNumber, source.draft.documentNumber);
  assert.equal((await billing.prepareCredit(source.id, 123)).id, r.id);
  advance(r, 'Anulación de la operación', []); await store.save(r);
  assert.match(summary(r, 1, false), /Nota de Crédito C TOTAL/);
  assert.match(summary(r, 1, false), /00001-00000055/);
  const issued = await billing.issue(r.id, 123);
  assert.equal(issued.status, 'authorized'); assert.deepEqual(calls, [13]);
  const data = invoiceData(issued, { point: 1, issuer });
  assert.equal(data.cbteTipo, 13); assert.equal(data.cbtesAsociados![0].numero, 55);
  const html = arcaWebTemplate({ data, options: { copy: 'ORIGINAL' }, qrDataUrl: '' } as Parameters<typeof arcaWebTemplate>[0]);
  assert.match(html, /NOTA DE CRÉDITO/); assert.match(html, /COD\. 013/); assert.match(html, /00001-00000055/);
  await billing.issue(r.id, 123); assert.deepEqual(calls, [13]);
  await assert.rejects(new Billing({} as Gateway, store, 1).prepareCredit(source.id, 123), /ya tiene/);
  assert.equal((await store.get(source.id, 123))!.status, 'authorized');
});

test('rechaza factura ajena, no autorizada, notas y alteraciones del importe', async () => {
  const { billing, source, store } = await setup();
  await assert.rejects(billing.prepareCredit(source.id, 456), /historial/);
  source.status = 'draft'; await store.save(source);
  await assert.rejects(billing.prepareCredit(source.id, 123), /historial/);
  source.status = 'authorized'; source.payload!.CbteTipo = 13; await store.save(source);
  await assert.rejects(billing.prepareCredit(source.id, 123), /historial/);
  source.payload!.CbteTipo = 11; await store.save(source);
  const r = await billing.prepareCredit(source.id, 123); advance(r, 'Motivo', []);
  r.draft.cents = 1; await store.save(r);
  await assert.rejects(billing.issue(r.id, 123), /no coincide/);
});

test('cancelar el borrador permite otra nota; timeout bloquea y recuperación consulta tipo 13 sin reemitir', async () => {
  const { billing, source, store, api } = await setup();
  const cancelled = await billing.prepareCredit(source.id, 123); cancelled.status = 'cancelled'; await store.save(cancelled);
  const r = await billing.prepareCredit(source.id, 123); assert.notEqual(r.id, cancelled.id);
  advance(r, 'Motivo de anulación', []); await store.save(r);
  api.createVoucher = async () => { throw new Error('Timeout'); };
  assert.equal((await billing.issue(r.id, 123)).status, 'uncertain');
  await assert.rejects(billing.prepareCredit(source.id, 123), /pendiente/);
  api.getVoucherInfo = async (number, point, type) => {
    assert.deepEqual([number, point, type], [1, 1, 13]);
    const p = (await store.get(r.id, 123))!.payload!;
    return { cbteDesde: p.CbteDesde, cbteHasta: p.CbteHasta, cbteFch: p.CbteFch, resultado: 'A', emisionTipo: 'CAE',
      codAutorizacion: '12345678901235', fchVto: '20261020', docTipo: p.DocTipo, docNro: p.DocNro,
      concepto: p.Concepto, impTotal: p.ImpTotal, impNeto: p.ImpNeto, impIVA: 0, impTrib: 0,
      impOpEx: 0, impTotConc: 0, monId: 'PES', monCotiz: 1 };
  };
  api.createVoucher = async () => { assert.fail('No reemitir'); };
  assert.equal((await billing.recover(r.id, 123)).status, 'authorized');
});
