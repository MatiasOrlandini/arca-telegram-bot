import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Billing, type Gateway } from '../src/billing.js';
import { buildVoucher } from '../src/invoice.js';
import { draft, MemoryStore, record } from './fixtures.js';

function gateway(): Gateway {
  return {
    getServerStatus: async () => ({ appServer: 'OK', dbServer: 'OK', authServer: 'OK' }),
    getLastVoucher: async () => ({ cbteNro: 10, ptoVta: 1, cbteTipo: 11 }),
    createVoucher: async p => ({ cae: '12345678901234', caeFchVto: '20261012', response: {
      FeCabResp: { Resultado: 'A' }, FeDetResp: { FECAEDetResponse: [{ Resultado: 'A', CbteDesde: p.CbteDesde, CAE: '12345678901234' }] },
    } }),
    getVoucherInfo: async () => null,
  };
}
test('autorización persiste payload y respuesta; doble confirmación no reemite', async () => {
  const store = new MemoryStore(); const r = record(); await store.save(r);
  const api = gateway(); let calls = 0; const create = api.createVoucher;
  api.createVoucher = async p => { calls++; assert.equal((await store.get(r.id, 123))!.status, 'issuing'); return create(p); };
  const billing = new Billing(api, store, 1);
  const result = await billing.issue(r.id, 123);
  assert.equal(result.status, 'authorized'); assert.equal(result.payload!.CbteDesde, 11);
  assert.equal(result.arcaResponse!.cae, '12345678901234');
  await billing.issue(r.id, 123); assert.equal(calls, 1);
});
test('timeout deja emisión incierta y bloquea otro comprobante', async () => {
  const store = new MemoryStore(); const r = record(); await store.save(r);
  const api = gateway(); api.createVoucher = async () => { throw new Error('timeout'); };
  const billing = new Billing(api, store, 1);
  assert.equal((await billing.issue(r.id, 123)).status, 'uncertain');
  const second = record(); second.id = 'b2b16ab8-0e87-40b5-9000-9229805db92c'; await store.save(second);
  await assert.rejects(billing.issue(second.id, 123), /pendiente/);
  await assert.rejects(billing.issue(r.id, 123), /no está listo/);
});
test('rechazo explícito se guarda con respuesta; no se reintenta automáticamente', async () => {
  const store = new MemoryStore(); const r = record(); await store.save(r);
  const api = gateway(); api.createVoucher = async () => ({ cae: '', caeFchVto: '', response: {
    FeDetResp: { FECAEDetResponse: [{ Resultado: 'R', Observaciones: { Obs: [{ Code: 1, Msg: 'Rechazo de prueba' }] } }] },
  } });
  const result = await new Billing(api, store, 1).issue(r.id, 123);
  assert.equal(result.status, 'rejected'); assert.ok(result.arcaResponse);
});
test('recuperación consulta mismo número; exige datos coincidentes y nunca emite', async () => {
  const store = new MemoryStore(); const r = record(); r.status = 'uncertain'; r.payload = buildVoucher(draft(), 1, 11); await store.save(r);
  const api = gateway(); let calls = 0;
  api.createVoucher = async () => { calls++; throw new Error('No emitir'); };
  api.getVoucherInfo = async (number, point, type) => {
    assert.deepEqual([number, point, type], [11, 1, 11]);
    const d = draft(); return { cbteDesde: 11, cbteHasta: 11, cbteFch: d.date, resultado: 'A', emisionTipo: 'CAE',
      codAutorizacion: '12345678901234', fchVto: '20261012', docTipo: 96, docNro: d.documentNumber,
      concepto: 2, impTotal: d.cents / 100, impNeto: d.cents / 100, impIVA: 0, impTrib: 0,
      impOpEx: 0, impTotConc: 0, monId: 'PES', monCotiz: 1 };
  };
  const billing = new Billing(api, store, 1);
  assert.equal((await billing.recover(r.id, 123)).status, 'authorized'); assert.equal(calls, 0);
  r.status = 'uncertain'; r.payload.ImpTotal = 1; await store.save(r);
  await assert.rejects(billing.recover(r.id, 123), /coincidente/);
  assert.equal((await store.get(r.id, 123))!.status, 'uncertain');
});
test('el borrador de otro usuario no puede emitirse', async () => {
  const store = new MemoryStore(); const r = record(); await store.save(r);
  await assert.rejects(new Billing(gateway(), store, 1).issue(r.id, 456), /No se encontró/);
});
test('una consulta de numeración fallida no envía la factura', async () => {
  const store = new MemoryStore(); const r = record(); await store.save(r);
  const api = gateway(); api.getLastVoucher = async () => ({ cbteNro: 0, ptoVta: 1, cbteTipo: 11, errors: { err: [{ code: 1, msg: 'Error' }] } });
  api.createVoucher = async () => { assert.fail('No emitir'); };
  await assert.rejects(new Billing(api, store, 1).issue(r.id, 123));
  assert.equal((await store.get(r.id, 123))!.status, 'draft');
});
test('si no puede guardarse el intento en la base, ARCA no recibe la factura', async () => {
  const store = new MemoryStore(); const r = record(); await store.save(r);
  store.save = async () => { throw new Error('Base desconectada'); };
  const api = gateway(); api.createVoucher = async () => { assert.fail('No emitir'); };
  await assert.rejects(new Billing(api, store, 1).issue(r.id, 123), /desconectada/);
});

for (const component of ['appServer', 'dbServer', 'authServer'] as const) {
  test(`si falla ${component}, conserva el borrador y no consulta numeración ni emite`, async () => {
    const store = new MemoryStore(); const r = record(); await store.save(r);
    const api = gateway();
    api.getServerStatus = async () => ({ appServer: 'OK', dbServer: 'OK', authServer: 'OK', [component]: 'FAIL' });
    api.getLastVoucher = async () => { assert.fail('No consultar numeración'); };
    api.createVoucher = async () => { assert.fail('No emitir'); };
    await assert.rejects(new Billing(api, store, 1).issue(r.id, 123), /no está disponible/);
    assert.equal((await store.get(r.id, 123))!.status, 'draft');
    assert.equal(await store.pending(), undefined);
  });
}

test('un fallo al consultar estado permite reintentar el mismo borrador cuando ARCA se recupera', async () => {
  const store = new MemoryStore(); const r = record(); await store.save(r);
  const api = gateway(); let statusCalls = 0; let issueCalls = 0;
  const create = api.createVoucher;
  api.getServerStatus = async () => {
    if (++statusCalls === 1) throw new Error('Timeout SOAP con datos internos');
    return { appServer: 'OK', dbServer: 'OK', authServer: 'OK' };
  };
  api.createVoucher = async p => { issueCalls++; return create(p); };
  const billing = new Billing(api, store, 1);
  await assert.rejects(billing.issue(r.id, 123), /No se pudo consultar el estado/);
  assert.equal(issueCalls, 0); assert.equal((await store.get(r.id, 123))!.status, 'draft');
  assert.equal((await billing.issue(r.id, 123)).status, 'authorized');
  assert.equal(statusCalls, 2); assert.equal(issueCalls, 1);
});
