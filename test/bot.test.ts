import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ElectronicBillingService } from '@arcasdk/core';
import type { Update } from 'grammy/types';
import { createBot } from '../src/bot.js';
import type { Config } from '../src/config.js';
import { buildVoucher } from '../src/invoice.js';
import { draft, MemoryStore, record } from './fixtures.js';
import { IssuerManager } from '../src/issuer.js';

function setup(issuer?: IssuerManager, fixedInvoice?: Config['fixedInvoice']) {
  const store = new MemoryStore();
  const config = { token: '123456:FAKE_TEST_TOKEN', allowedUsers: new Set([123]), point: 1, production: false, fixedInvoice,
    issuer: { cuit: '20123456786', razonSocial: 'Prueba', domicilioComercial: 'Prueba 123', condicionIva: 'Responsable Monotributo', iibb: 'Exento', fechaInicioActividades: '20260101' } } as Config;
  const api = {
    getServerStatus: async () => ({ appServer: 'OK', dbServer: 'OK', authServer: 'OK' }),
    getIvaReceptorTypes: async () => ({ resultGet: { condicionIvaReceptor: [{ id: 5, desc: 'Consumidor Final', cmp_Clase: 'C' }] } }),
    getLastVoucher: async () => ({ cbteNro: 10, ptoVta: 1, cbteTipo: 11 }),
    createVoucher: async () => ({ cae: '12345678901234', caeFchVto: '20261012', response: { FeDetResp: { FECAEDetResponse: [{ Resultado: 'A' }] } } }),
  } as unknown as ElectronicBillingService;
  const bot = createBot(config, store, api, issuer);
  bot.botInfo = { id: 999, is_bot: true, first_name: 'Test', username: 'test_bot', can_join_groups: false,
    can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false,
    has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false,
    can_manage_bots: false, supports_join_request_queries: false };
  const calls: { method: string; payload: any }[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: method === 'answerCallbackQuery' ? true : { message_id: calls.length, date: 0, chat: { id: 123, type: 'private' } } } as any;
  });
  return { store, bot, calls };
}
function message(user: number, text: string, group = false): Update {
  return { update_id: 1, message: { message_id: 1, date: 0, from: { id: user, is_bot: false, first_name: 'Test' },
    chat: group ? { id: -100, type: 'group', title: 'Test' } : { id: user, type: 'private', first_name: 'Test' },
    text, ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}) } };
}
test('Telegram bloquea usuarios no autorizados y grupos', async () => {
  const { bot, store, calls } = setup();
  await bot.handleUpdate(message(456, '/factura'));
  assert.equal(store.records.size, 0); assert.match(calls[0].payload.text, /No tenés acceso/);
  await bot.handleUpdate(message(123, '/factura', true));
  assert.equal(store.records.size, 0); assert.equal(calls.length, 1);
});

test('factura_fija continúa su borrador sin volver a pedir receptor y no emite antes de confirmar', async () => {
  const fixed = { cuit: '20123456786', name: 'RECEPTOR FIJO', address: 'Calle 123', ivaId: '5',
    description: 'Servicio fijo', paymentMethod: 'Contado' };
  const { bot, store, calls } = setup(undefined, fixed);
  await bot.handleUpdate(message(456, '/factura_fija')); assert.equal(store.records.size, 0);
  await bot.handleUpdate(message(123, '/factura_fija'));
  const r = await store.active(123); assert.equal(r!.step, 'amount');
  assert.equal(r!.draft.name, 'RECEPTOR FIJO');
  fixed.name = 'OTRO NOMBRE';
  await bot.handleUpdate(message(123, '1000')); await bot.handleUpdate(message(123, '/factura_fija'));
  assert.equal(store.records.size, 1);
  await bot.handleUpdate(message(123, '2026-09-01')); await bot.handleUpdate(message(123, '2026-09-30'));
  await bot.handleUpdate(message(123, '2099-01-01'));
  const saved = (await store.get(r!.id, 123))!;
  assert.equal(saved.step, 'confirm'); assert.equal(saved.status, 'draft');
  assert.equal(saved.draft.name, 'RECEPTOR FIJO'); assert.equal(saved.payload, undefined);
  assert.ok(calls.some(c => (c.payload.text ?? '').includes('Servicio fijo') && c.payload.reply_markup));
});

test('factura_fija sin configuración no crea borrador ni reemplaza uno manual', async () => {
  const { bot, store } = setup();
  await bot.handleUpdate(message(123, '/factura_fija')); assert.equal(store.records.size, 0);
  const r = await store.create(123);
  await bot.handleUpdate(message(123, '/factura_fija'));
  assert.deepEqual((await store.get(r.id, 123))!.draft, {});
});

test('verificar_produccion respeta acceso privado autorizado y no crea facturas', async () => {
  const { bot, store, calls } = setup();
  await bot.handleUpdate(message(456, '/verificar_produccion'));
  assert.match(calls[0].payload.text, /No tenés acceso/);
  await bot.handleUpdate(message(123, '/verificar_produccion', true));
  assert.equal(calls.length, 1);
  await bot.handleUpdate(message(123, '/verificar_produccion'));
  assert.match(calls[1].payload.text, /HOMOLOGACIÓN/);
  assert.equal(store.records.size, 0);
});
test('Telegram envía CAE, respuesta JSON y PDF tras confirmar', async () => {
  const { bot, store, calls } = setup();
  const r = record(); await store.save(r);
  store.pdfs.set(r.id, Buffer.from('%PDF-1.7\nfixture'));
  await bot.handleUpdate({ update_id: 2, callback_query: { id: 'callback', chat_instance: 'test', data: `emit:${r.id}`,
    from: { id: 123, is_bot: false, first_name: 'Test' }, message: { message_id: 1, date: 0, chat: { id: 123, type: 'private', first_name: 'Test' } } } });
  assert.equal((await store.get(r.id, 123))!.status, 'authorized');
  const texts = calls.filter(c => c.method === 'sendMessage').map(c => c.payload.text);
  assert.ok(texts.some(t => /CAE: 12345678901234/.test(t)));
  const documents = calls.filter(c => c.method === 'sendDocument');
  assert.equal(documents.length, 2);
  assert.match(documents[0].payload.document.filename, /respuesta-arca.*\.json/);
  assert.equal(documents[1].payload.document.filename, '20123456786_011_00001_00000011.pdf');
});
test('descarga de PDF ajeno no entrega documentos', async () => {
  const { bot, store, calls } = setup();
  const r = record(); r.userId = 456; r.status = 'authorized'; r.payload = buildVoucher(draft(), 1, 11);
  await store.save(r); store.pdfs.set(r.id, Buffer.from('private'));
  await bot.handleUpdate(message(123, `/pdf ${r.id}`));
  assert.equal(calls.filter(c => c.method === 'sendDocument').length, 0);
});

test('Telegram prepara nota total y pide confirmación sin emitir al iniciar', async () => {
  const { bot, store, calls } = setup();
  const source = record(); source.status = 'authorized'; source.payload = buildVoucher(draft(), 1, 55);
  source.cae = '12345678901234'; source.issuer = { cuit: '20123456786', razonSocial: 'Prueba', domicilioComercial: 'Prueba', condicionIva: 'Responsable Monotributo', iibb: 'Exento', fechaInicioActividades: '20260101' };
  await store.save(source);
  await bot.handleUpdate(message(123, `/nota_credito ${source.id}`));
  const r = await store.active(123); assert.equal(r!.step, 'creditReason');
  await bot.handleUpdate(message(123, 'Anulación de la operación'));
  assert.equal((await store.get(r!.id, 123))!.status, 'draft');
  assert.ok(calls.some(c => /Nota de Crédito C TOTAL/.test(c.payload.text ?? '') && c.payload.reply_markup));
});

test('Telegram pide solamente los datos faltantes del emisor antes de crear un borrador', async () => {
  const issuerStore = new MemoryStore();
  const manager = new IssuerManager({ cuit: '20123456786', razonSocial: 'Emisor', domicilioComercial: 'Prueba 123',
    condicionIva: 'Responsable Monotributo', iibb: '', fechaInicioActividades: '' }, issuerStore, async () => null);
  await manager.initialize();
  const { bot, store, calls } = setup(manager);
  await bot.handleUpdate(message(123, '/factura'));
  assert.equal(store.records.size, 0);
  assert.ok(calls.some(c => String(c.payload.text).includes('Ingresá tu número de Ingresos Brutos')));
  await bot.handleUpdate(message(123, '0215066439'));
  await bot.handleUpdate(message(123, '2022-09-01'));
  assert.equal(manager.complete().fechaInicioActividades, '20220901');
  assert.equal(issuerStore.issuer!.iibb, '0215066439');
  assert.equal(store.records.size, 1);
  assert.equal((await store.active(123))!.step, 'documentType');
});
