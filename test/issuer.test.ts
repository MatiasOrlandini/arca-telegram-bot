import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TaxpayerDetailsDto } from '@arcasdk/core';
import { IssuerManager, issuerFromPadron } from '../src/issuer.js';
import { MemoryStore, record } from './fixtures.js';
import { Billing, type Gateway } from '../src/billing.js';
import { invoiceData } from '../src/pdf.js';

const seed = { cuit: '20123456786', razonSocial: '', domicilioComercial: '', condicionIva: 'Responsable Monotributo', iibb: '', fechaInicioActividades: '' };
const person = {
  idPersona: 20123456786,
  datosGenerales: { idPersona: 20123456786, apellido: 'PRUEBA', nombre: 'PERSONA',
    domicilioFiscal: { direccion: 'Calle 123', localidad: 'Rosario', descripcionProvincia: 'Santa Fe' } },
  datosMonotributo: { impuesto: [{ idImpuesto: 20, periodo: 202209 }] },
} as unknown as TaxpayerDetailsDto;

test('diagnóstico temporal muestra null o respuesta SDK en un mensaje, ocultando credenciales', async () => {
  const empty = new IssuerManager(seed, new MemoryStore(), async () => null);
  await empty.initialize(); assert.match(empty.diagnosticSummary(), /temporal\):\nnull$/);
  const manager = new IssuerManager(seed, new MemoryStore(), async () => ({ ...person,
    token: 'SECRET', auth: { sign: 'PRIVATE' }, extra: 'x'.repeat(8000) } as unknown as TaxpayerDetailsDto));
  await manager.initialize();
  const result = manager.diagnosticSummary();
  assert.match(result, /PRUEBA/); assert.doesNotMatch(result, /SECRET|PRIVATE/);
  assert.ok(result.length <= 4000); assert.match(result, /recortada/);
  assert.doesNotMatch(manager.summary(), /extra/);
});

test('el padrón completa identidad y domicilio sin inventar IIBB ni la fecha de inicio', () => {
  const data = issuerFromPadron(person, seed.cuit);
  assert.equal(data.razonSocial, 'PRUEBA PERSONA');
  assert.equal(data.domicilioComercial, 'Calle 123 - Rosario, Santa Fe');
  assert.equal(data.iibb, undefined); assert.equal(data.fechaInicioActividades, undefined);
  assert.deepEqual(issuerFromPadron(person, '23394545929'), {});
  assert.deepEqual(issuerFromPadron({ ...person, errorConstancia: { error: 'Error' } }, seed.cuit), {});
});
test('valores explícitos tienen prioridad; faltantes se guardan y sobreviven al reinicio', async () => {
  const store = new MemoryStore();
  const manager = new IssuerManager({ ...seed, domicilioComercial: 'Domicilio comercial propio' }, store, async cuit => {
    assert.equal(cuit, Number(seed.cuit)); return person;
  });
  await manager.initialize();
  assert.equal(manager.current.domicilioComercial, 'Domicilio comercial propio');
  assert.deepEqual(manager.missing, ['iibb', 'fechaInicioActividades']);
  assert.throws(() => manager.complete(), /Faltan datos/);
  await manager.supply('iibb', '0215066439');
  await assert.rejects(manager.supply('fechaInicioActividades', '2099-01-01'), /futuro/);
  await assert.rejects(manager.supply('fechaInicioActividades', '2025-02-29'), /no existe/);
  await manager.supply('fechaInicioActividades', '2022-09-01');
  assert.equal(manager.complete().iibb, '0215066439');
  const restarted = new IssuerManager(seed, store, async () => { throw new Error('Not authorized: secret token'); });
  await restarted.initialize();
  assert.equal(restarted.complete().fechaInicioActividades, '20220901');
  assert.ok(!restarted.notice.includes('secret token'));
});
test('una sociedad usa razón social y una respuesta vacía permite cargar datos manualmente', async () => {
  const company = { idPersona: Number(seed.cuit), datosGenerales: { razonSocial: 'EMPRESA DE PRUEBA' } } as unknown as TaxpayerDetailsDto;
  assert.equal(issuerFromPadron(company, seed.cuit).razonSocial, 'EMPRESA DE PRUEBA');
  const manager = new IssuerManager(seed, new MemoryStore(), async () => null);
  await manager.initialize(); assert.equal(manager.missing.length, 4);
  await manager.supply('razonSocial', 'Persona de prueba');
  assert.equal(manager.current.razonSocial, 'Persona de prueba');
});
test('si falla la persistencia de un dato, no se marca como completado', async () => {
  const store = new MemoryStore(); const manager = new IssuerManager(seed, store, async () => person);
  await manager.initialize(); store.saveIssuer = async () => { throw new Error('Base desconectada'); };
  await assert.rejects(manager.supply('iibb', 'Exento'));
  assert.ok(manager.missing.includes('iibb'));
});
test('emisión exige emisor completo y guarda sus datos para regenerar el PDF histórico', async () => {
  const store = new MemoryStore(); const r = record(); await store.save(r);
  const manager = new IssuerManager(seed, store, async () => person); await manager.initialize();
  let calls = 0;
  const gateway: Gateway = {
    getServerStatus: async () => ({ appServer: 'OK', dbServer: 'OK', authServer: 'OK' }),
    getLastVoucher: async () => ({ cbteNro: 10, ptoVta: 1, cbteTipo: 11 }),
    createVoucher: async () => { calls++; return { cae: '12345678901234', caeFchVto: '20261012', response: { FeDetResp: { FECAEDetResponse: [{ Resultado: 'A' }] } } }; },
    getVoucherInfo: async () => null,
  };
  const billing = new Billing(gateway, store, 1, () => manager.complete());
  await assert.rejects(billing.issue(r.id, r.userId), /Faltan datos/); assert.equal(calls, 0);
  await manager.supply('iibb', '0215066439'); await manager.supply('fechaInicioActividades', '2022-09-01');
  const issued = await billing.issue(r.id, r.userId);
  assert.equal(issued.issuer!.razonSocial, 'PRUEBA PERSONA');
  const pdfData = invoiceData(issued, { point: 1, issuer: { ...manager.current, razonSocial: 'NOMBRE MODIFICADO' } });
  assert.equal(pdfData.emisor.razonSocial, 'PRUEBA PERSONA');
});
