import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { record } from './fixtures.js';

test('PostgreSQL: persistencia, aislamiento, bloqueo, recuperación y PDF', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  const context = `test:${randomUUID()}`;
  const store = new Store(url, context);
  const other = new Store(url, context);
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    await store.open();
    const issuer = { cuit: '20123456786', razonSocial: 'Prueba', domicilioComercial: 'Prueba 123',
      condicionIva: 'Responsable Monotributo', iibb: '0215066439', fechaInicioActividades: '20220901' };
    await store.saveIssuer(issuer);
    assert.deepEqual(await store.getIssuer(), issuer);
    await assert.rejects(other.open(), /otro bot/);
    await other.close();
    const r = record(); await store.save(r);
    assert.deepEqual(await store.get(r.id, r.userId), r);
    assert.equal(await store.get(r.id, r.userId + 1), undefined);
    assert.equal(await store.get('malformed', r.userId), undefined);
    const second = record(); second.id = randomUUID();
    await assert.rejects(store.save(second), /duplicate key/);
    r.status = 'issuing'; await store.save(r);
    second.userId = 456; second.status = 'issuing';
    await assert.rejects(store.save(second), /duplicate key/);
    await store.close();
    const restarted = new Store(url, context); await restarted.open();
    assert.deepEqual(await restarted.getIssuer(), issuer);
    assert.equal((await restarted.pending())!.status, 'uncertain');
    const recovered = (await restarted.get(r.id, r.userId))!;
    recovered.status = 'authorized'; recovered.cae = '12345678901234';
    await restarted.save(recovered);
    const pdf = Buffer.from('%PDF-1.7\nfixture');
    await restarted.savePdf(r.id, r.userId, pdf);
    assert.deepEqual(await restarted.getPdf(r.id, r.userId), pdf);
    assert.equal(await restarted.getPdf(r.id, 456), undefined);
    assert.equal(await restarted.pending(), undefined);
    await restarted.close();
  } finally {
    await store.close().catch(() => {});
    await other.close().catch(() => {});
    await admin.query('DELETE FROM arca_bot_invoices WHERE context=$1', [context]);
    await admin.query('DELETE FROM arca_bot_issuer WHERE context=$1', [context]);
    await admin.end();
  }
});
