import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyProduction } from '../src/production-check.js';

function setup() {
  const calls: string[] = [];
  const service = {
    getServerStatus: async () => { calls.push('status'); return { appServer: 'OK', dbServer: 'OK', authServer: 'OK' }; },
    getSalesPoints: async () => { calls.push('points'); return { resultGet: { ptoVenta: [{ nro: 2, emisionTipo: 'CAE', bloqueado: 'N', fechaBaja: '' }] } }; },
    getLastVoucher: async (point: number, type: number) => { calls.push('last'); assert.equal(point, 2); assert.equal(type, 11); return { cbteNro: 0, ptoVta: 2, cbteTipo: 11 }; },
    createVoucher: async () => { assert.fail('La verificación nunca debe emitir'); },
  };
  return { service, calls, config: { production: true, point: 2 } };
}

test('verificación en homologación no hace consultas', async () => {
  const { config, service, calls } = setup(); config.production = false;
  assert.match(await verifyProduction(config, service), /HOMOLOGACIÓN/);
  assert.deepEqual(calls, []);
});

test('verificación producción consulta WSFE y numeración sin emitir, incluso con cero facturas', async () => {
  const { config, service, calls } = setup();
  const result = await verifyProduction(config, service);
  assert.match(result, /certificado autenticado/); assert.match(result, /Próximo número según esta consulta: 1/);
  assert.match(result, /no garantizan/); assert.deepEqual(calls, ['status', 'points', 'last']);
});

test('servidores caídos detienen la verificación', async () => {
  const { config, service, calls } = setup();
  service.getServerStatus = async () => ({ appServer: 'ERROR', dbServer: 'OK', authServer: 'OK' });
  assert.match(await verifyProduction(config, service), /Algún servidor/); assert.deepEqual(calls, []);
});

test('punto CAE - Monotributo con fechaBaja NULL está habilitado', async () => {
  const { config, service, calls } = setup();
  service.getSalesPoints = async () => ({ resultGet: { ptoVenta: [
    { nro: 2, emisionTipo: 'CAE - Monotributo', bloqueado: 'N', fechaBaja: 'NULL' },
  ] } });
  const result = await verifyProduction(config, service);
  assert.match(result, /punto de venta 2 activo para CAE/);
  assert.match(result, /última Factura C autorizada: 0/);
  assert.doesNotMatch(result, /ERROR/);
  assert.ok(calls.includes('last'));
});

test('punto ausente, bloqueado, dado de baja o sin CAE no permite afirmar habilitación', async () => {
  for (const point of [
    { nro: 3, emisionTipo: 'CAE', bloqueado: 'N', fechaBaja: '' },
    { nro: 2, emisionTipo: 'CAE', bloqueado: 'S', fechaBaja: '' },
    { nro: 2, emisionTipo: 'CAE', bloqueado: 'N', fechaBaja: '20261001' },
    { nro: 2, emisionTipo: 'CAEA', bloqueado: 'N', fechaBaja: '' },
  ]) {
    const { config, service, calls } = setup();
    service.getSalesPoints = async () => ({ resultGet: { ptoVenta: [point] } });
    assert.match(await verifyProduction(config, service), /ERROR: punto/); assert.ok(!calls.includes('last'));
  }
});

test('errores devueltos por ARCA y numeración incorrecta no se reportan como éxito', async () => {
  const { config, service } = setup();
  assert.match(await verifyProduction(config, { ...service, getSalesPoints: async () => ({ errors: { err: [{ code: 600, msg: 'rechazado' }] } }) }), /ERROR: consulta autenticada/);
  assert.match(await verifyProduction(config, { ...service, getLastVoucher: async () => ({ cbteNro: 1, ptoVta: 99, cbteTipo: 11 }) }), /ERROR: ARCA no devolvió/);
});

test('error del SDK informa la etapa sin filtrar secretos', async () => {
  const { config, service } = setup();
  service.getSalesPoints = async () => { throw new Error('SOAP SECRET_TOKEN'); };
  const result = await verifyProduction(config, service);
  assert.match(result, /autenticación y acceso a WSFE/); assert.doesNotMatch(result, /SECRET_TOKEN/);
});
