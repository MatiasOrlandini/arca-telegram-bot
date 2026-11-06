import { Bot, InlineKeyboard, InputFile, type Context } from 'grammy';
import type { ElectronicBillingService } from '@arcasdk/core';
import type { Config } from './config.js';
import type { Repository, Record } from './store.js';
import { Billing } from './billing.js';
import { advance, prompts, summary, fixedServiceDraft, type IvaOption } from './wizard.js';
import { displayDate } from './invoice.js';
import { getPdf } from './pdf.js';
import { UserError, formatError } from './errors.js';
import { IssuerManager, issuerPrompts, type IssuerField } from './issuer.js';
import { verifyProduction } from './production-check.js';

export function createBot(config: Config, store: Repository, service: ElectronicBillingService, issuer?: IssuerManager) {
  const bot = new Bot(config.token);
  const billing = new Billing(service, store, config.point, issuer ? () => issuer.complete() : undefined);
  const issuerSessions = new Map<number, { field: IssuerField; resumeInvoice: boolean }>();
  async function ensureIssuer(ctx: Context, resumeInvoice: boolean): Promise<boolean> {
    if (!issuer?.missing.length) return true;
    const field = issuer.missing[0];
    issuerSessions.set(ctx.from!.id, { field, resumeInvoice });
    await ctx.reply(issuer.summary());
    await ctx.reply(issuerPrompts[field]);
    return false;
  }
  let ivaOptions: IvaOption[] = [];
  async function catalog() {
    if (!ivaOptions.length) {
      const result = await service.getIvaReceptorTypes('C');
      if (result.errors?.err?.length || !result.resultGet?.condicionIvaReceptor?.length)
        throw new UserError('No se pudo obtener la lista de condiciones IVA de ARCA. Volvé a intentar.');
      ivaOptions = result.resultGet.condicionIvaReceptor;
    }
    return ivaOptions;
  }
  async function prompt(ctx: Context, r: Record) {
    if (r.step === 'confirm') {
      await ctx.reply((issuer ? issuer.summary() + '\n\n' : '') + summary(r, config.point, config.production), {
        reply_markup: new InlineKeyboard().text('Confirmar y emitir', `emit:${r.id}`).text('Cancelar', `cancel:${r.id}`),
      });
    } else if (r.step === 'iva') {
      const options = await catalog();
      await ctx.reply('Ingresá el código de la condición IVA del receptor:\n' + options.map(o => `${o.id}: ${o.desc}`).join('\n'));
    } else await ctx.reply(prompts[r.step]);
  }

  async function sendPdf(ctx: Context, r: Record) {
    try {
      const buffer = await getPdf(r, issuer ? { ...config, issuer: issuer.current } : config, store);
      const filename = [
        (r.issuer ?? config.issuer).cuit,
        String(r.payload!.CbteTipo).padStart(3, '0'),
        String(r.payload!.PtoVta).padStart(5, '0'),
        String(r.payload!.CbteDesde).padStart(8, '0'),
      ].join('_') + '.pdf';
      await ctx.replyWithDocument(new InputFile(buffer, filename));
    } catch {
      await ctx.reply(`La factura está autorizada y guardada. No se pudo generar o enviar el PDF. Reintentá con /pdf ${r.id}`);
    }
  }
  async function sendResult(ctx: Context, r: Record) {
    const label = r.payload?.CbteTipo === 13 ? 'Nota de Crédito C' : 'Factura C';
    if (r.status === 'authorized') {
      await ctx.reply(`${label} autorizada${config.production ? '' : ' en HOMOLOGACIÓN (sin validez fiscal)'}.\nPunto de venta: ${r.payload!.PtoVta}\nNúmero: ${r.payload!.CbteDesde}\nCAE: ${r.cae}\nVencimiento del CAE: ${displayDate(r.expiration!)}\nID: ${r.id}`);
    } else if (r.status === 'rejected') await ctx.reply(`ARCA rechazó la factura. Revisá la respuesta adjunta. Podés iniciar una nueva con /factura.\nID: ${r.id}`);
    else await ctx.reply(`La emisión quedó pendiente de confirmación. Usá /recuperar ${r.id}. Se bloquean nuevas emisiones para evitar duplicados.`);
    if (r.arcaResponse || r.arcaConsultation) {
      try {
        await ctx.replyWithDocument(new InputFile(Buffer.from(JSON.stringify(r.arcaResponse ?? r.arcaConsultation, null, 2), 'utf8'), `respuesta-arca-${r.id}.json`));
      } catch { await ctx.reply(`La respuesta está guardada. Descargala con /respuesta ${r.id}`); }
    }
    if (r.status === 'authorized') await sendPdf(ctx, r);
  }

  bot.command('miid', async ctx => {
    if (ctx.chat.type === 'private') await ctx.reply(`Tu ID de Telegram es ${ctx.from!.id}.`);
  });
  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.chat?.type !== 'private' || !config.allowedUsers.has(ctx.from.id)) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery('Sin acceso.');
      else if (ctx.chat?.type === 'private') await ctx.reply('No tenés acceso a este bot. Usá /miid para conocer tu ID.');
      return;
    }
    try { await next(); }
    catch (error) {
      if (error instanceof UserError) await ctx.reply(error.message);
      else {
        console.error('Operación fallida:\n' + formatError(error));
        await ctx.reply('No se pudo completar la operación. Consultá /historial antes de volver a emitir.');
      }
    }
  });
  const help = 'Bot de facturas C para monotributo.\n/factura: crear o continuar un borrador\n/factura_fija: servicio y receptor configurados en .env\n/nota_credito ID: crear una Nota de Crédito C total\n/emisor: ver o completar mis datos fiscales\n/cancelar: descartar borrador\n/historial: últimas operaciones\n/pdf ID: descargar PDF\n/respuesta ID: datos devueltos por ARCA\n/recuperar ID: consultar una emisión pendiente\n/estado: verificar ARCA\n/verificar_produccion: verificar producción sin emitir\n/miid: ver tu ID';
  bot.command(['start', 'ayuda'], ctx => ctx.reply(`${help}\n\nAmbiente: ${config.production ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN'}`));
  bot.command('factura', async ctx => {
    if (!await ensureIssuer(ctx, true)) return;
    const r = await store.active(ctx.from!.id) ?? await store.create(ctx.from!.id);
    await prompt(ctx, r);
  });
  bot.command('factura_fija', async ctx => {
    if (issuer?.missing.length) throw new UserError('Completá los datos del emisor con /emisor antes de usar /factura_fija.');
    const active = await store.active(ctx.from!.id);
    if (active) {
      if (!active.draft.fixedService || active.draft.voucherType === 13)
        throw new UserError('Ya tenés otro borrador. Completalo o usá /cancelar antes de usar /factura_fija.');
      await prompt(ctx, active); return;
    }
    const draft = fixedServiceDraft(config.fixedInvoice, await catalog());
    const r = await store.create(ctx.from!.id);
    r.draft = draft; r.step = 'amount';
    await store.save(r);
    await prompt(ctx, r);
  });
  bot.command('nota_credito', async ctx => {
    if (issuer?.missing.length) throw new UserError('Completá los datos del emisor con /emisor antes de crear la nota de crédito.');
    await prompt(ctx, await billing.prepareCredit(ctx.match.trim(), ctx.from!.id));
  });
  bot.command('cancelar', async ctx => {
    if (issuerSessions.delete(ctx.from!.id)) { await ctx.reply('Carga de datos del emisor cancelada. Los datos ya guardados se conservan.'); return; }
    const r = await store.active(ctx.from!.id);
    if (!r) { await ctx.reply('No hay un borrador activo.'); return; }
    r.status = 'cancelled'; await store.save(r); await ctx.reply('Borrador cancelado.');
  });
  bot.command('emisor', async ctx => {
    if (!issuer) { await ctx.reply('Los datos del emisor están configurados en .env.'); return; }
    if (!await ensureIssuer(ctx, false)) return;
    issuerSessions.delete(ctx.from!.id);
    await ctx.reply(issuer.diagnosticSummary());
  });
  bot.command('historial', async ctx => {
    const records = await store.list(ctx.from!.id);
    const labels = { draft: 'Borrador', issuing: 'Emitiendo', uncertain: 'Pendiente de confirmar', authorized: 'Autorizada', rejected: 'Rechazada', cancelled: 'Cancelada' };
    await ctx.reply(records.length ? records.map(r => `${r.draft.voucherType === 13 ? 'Nota de Crédito C' : 'Factura C'} · ${labels[r.status]}${r.payload ? ` · N° ${r.payload.CbteDesde}` : ''}\n${r.id}`).join('\n\n') : 'No hay operaciones.');
  });
  bot.command('pdf', async ctx => {
    const r = await store.get(ctx.match.trim(), ctx.from!.id);
    if (!r || r.status !== 'authorized') throw new UserError('Usá /pdf ID con el ID de una factura autorizada de tu historial.');
    await sendPdf(ctx, r);
  });
  bot.command('respuesta', async ctx => {
    const r = await store.get(ctx.match.trim(), ctx.from!.id);
    if (!r || (!r.arcaResponse && !r.arcaConsultation)) throw new UserError('No hay una respuesta guardada para ese ID.');
    await ctx.replyWithDocument(new InputFile(Buffer.from(JSON.stringify(r.arcaResponse ?? r.arcaConsultation, null, 2)), `respuesta-arca-${r.id}.json`));
  });
  bot.command('recuperar', async ctx => { await sendResult(ctx, await billing.recover(ctx.match.trim(), ctx.from!.id)); });
  bot.command('estado', async ctx => {
    const result = await service.getServerStatus();
    await ctx.reply(`Estado de ARCA:\n${JSON.stringify(result, null, 2)}`);
  });
  bot.command('verificar_produccion', async ctx => {
    await ctx.reply(await verifyProduction(config, service));
  });
  bot.callbackQuery(/^emit:([0-9a-f-]+)$/, async ctx => {
    await ctx.answerCallbackQuery('Procesando comprobante…');
    await sendResult(ctx, await billing.issue(ctx.match[1], ctx.from.id));
  });
  bot.callbackQuery(/^cancel:([0-9a-f-]+)$/, async ctx => {
    await ctx.answerCallbackQuery();
    const r = await store.get(ctx.match[1], ctx.from.id);
    if (!r || r.status !== 'draft') throw new UserError('Ese borrador ya no se puede cancelar.');
    r.status = 'cancelled'; await store.save(r); await ctx.reply('Borrador cancelado.');
  });
  bot.on('message:text', async ctx => {
    if (ctx.message.text.startsWith('/')) { await ctx.reply(help); return; }
    const issuerSession = issuerSessions.get(ctx.from.id);
    if (issuer && issuerSession) {
      if (issuer.missing.includes(issuerSession.field)) await issuer.supply(issuerSession.field, ctx.message.text);
      else await ctx.reply('Ese dato ya fue completado por otro usuario autorizado.');
      const next = issuer.missing[0];
      if (next) {
        issuerSession.field = next;
        await ctx.reply(issuerPrompts[next]);
      } else {
        issuerSessions.delete(ctx.from.id);
        await ctx.reply('Datos del emisor guardados.\n' + issuer.summary());
        if (issuerSession.resumeInvoice) {
          const r = await store.active(ctx.from.id) ?? await store.create(ctx.from.id);
          await prompt(ctx, r);
        }
      }
      return;
    }
    const r = await store.active(ctx.from.id);
    if (!r) { await ctx.reply('Usá /factura para comenzar.'); return; }
    advance(r, ctx.message.text, r.step === 'iva' ? await catalog() : []);
    await store.save(r);
    await prompt(ctx, r);
  });
  bot.catch(error => console.error('No se pudo procesar una actualización de Telegram:\n' + formatError(error.error)));
  return bot;
}
