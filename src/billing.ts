import type { ElectronicBillingService, VoucherInfoResultDto } from '@arcasdk/core';
import { buildVoucher, today, type Draft, type IVoucher } from './invoice.js';
import type { Repository, Record } from './store.js';
import { UserError as Error } from './errors.js';
import type { EmisorData } from '@arcasdk/pdf';
import { randomUUID } from 'node:crypto';

export type Gateway = Pick<ElectronicBillingService, 'getServerStatus' | 'getLastVoucher' | 'createVoucher' | 'getVoucherInfo'>;

export function matchesVoucher(info: VoucherInfoResultDto, p: IVoucher): boolean {
  return info.resultado === 'A' && info.emisionTipo === 'CAE' && !!info.codAutorizacion && !!info.fchVto &&
    info.cbteDesde === p.CbteDesde && info.cbteHasta === p.CbteHasta && info.cbteFch === p.CbteFch &&
    info.docTipo === p.DocTipo && info.docNro === p.DocNro && info.concepto === p.Concepto &&
    info.monId === p.MonId && info.monCotiz === p.MonCotiz &&
    info.impTotal === p.ImpTotal && info.impNeto === p.ImpNeto && info.impIVA === 0 &&
    info.impTrib === 0 && info.impOpEx === 0 && info.impTotConc === 0;
}

export class Billing {
  private busy = false;
  constructor(private gateway: Gateway, private store: Repository, private point: number,
    private issuer?: () => EmisorData) {}

  async prepareCredit(invoiceId: string, userId: number): Promise<Record> {
    if (this.busy || await this.store.pending()) throw new Error('Hay una emisión pendiente. Resolvela antes de crear una nota de crédito.');
    const source = await this.store.get(invoiceId, userId);
    if (!source || source.status !== 'authorized' || source.payload?.CbteTipo !== 11 || !source.cae)
      throw new Error('Usá /nota_credito ID con una Factura C autorizada de tu historial en este ambiente y punto de venta.');
    const existing = await this.store.creditFor(invoiceId);
    if (existing) {
      if (existing.status === 'draft' && existing.userId === userId) return existing;
      throw new Error('Esta factura ya tiene una nota de crédito total autorizada o pendiente en el bot.');
    }
    if (await this.store.active(userId)) throw new Error('Ya tenés un borrador. Completalo o usá /cancelar antes de crear la nota de crédito.');
    const issuer = source.issuer ?? this.issuer?.();
    if (!issuer) throw new Error('Completá los datos del emisor con /emisor.');
    const d = structuredClone(source.draft) as Draft;
    d.voucherType = 13; d.date = today(); d.paymentDue = d.concept !== 1 ? today() : undefined;
    d.associatedVoucher = { Tipo: 11, PtoVta: source.payload.PtoVta, Nro: source.payload.CbteDesde,
      Cuit: issuer.cuit, CbteFch: source.payload.CbteFch };
    const r: Record = { id: randomUUID(), userId, step: 'creditReason', status: 'draft', draft: d,
      sourceInvoiceId: source.id, issuer, createdAt: new Date().toISOString() };
    await this.store.save(r);
    return r;
  }

  async issue(id: string, userId: number): Promise<Record> {
    const r = await this.store.get(id, userId);
    if (!r) throw new Error('No se encontró ese borrador.');
    if (r.status === 'authorized') return r;
    if (r.status !== 'draft' || r.step !== 'confirm') throw new Error('Este borrador no está listo para emitir.');
    if (this.busy) throw new Error('Hay una emisión en curso.');
    if (r.draft.date !== today()) throw new Error('El borrador es de otro día. Cancelalo y creá uno nuevo.');
    buildVoucher(r.draft as Draft, this.point, 1);
    if ((r.draft.voucherType ?? 11) === 13) {
      const source = r.sourceInvoiceId ? await this.store.get(r.sourceInvoiceId, userId) : undefined;
      const existing = source ? await this.store.creditFor(source.id) : undefined;
      const a = r.draft.associatedVoucher;
      if (!source || source.status !== 'authorized' || source.payload?.CbteTipo !== 11 || existing?.id !== r.id ||
          a?.PtoVta !== source.payload.PtoVta || a?.Nro !== source.payload.CbteDesde ||
          a?.Cuit !== r.issuer?.cuit || r.draft.cents !== Math.round(source.payload.ImpTotal * 100) ||
          r.draft.documentType !== source.payload.DocTipo || r.draft.documentNumber !== source.payload.DocNro)
        throw new Error('La nota de crédito no coincide con la factura original o ya existe otra.');
    } else if (this.issuer) r.issuer = this.issuer();
    this.busy = true;
    try {
      if (await this.store.pending()) throw new Error('Hay una emisión pendiente de resolver. Consultá /historial y /recuperar.');
      const status = await this.gateway.getServerStatus().catch(() => {
        throw new Error('No se pudo consultar el estado de ARCA. El borrador sigue sin emitir. Volvé a confirmar cuando el servicio esté disponible.');
      });
      if (status?.appServer !== 'OK' || status?.dbServer !== 'OK' || status?.authServer !== 'OK') {
        throw new Error('ARCA informa que alguno de sus servicios no está disponible. El borrador sigue sin emitir. Volvé a confirmar más tarde.');
      }
      const last = await this.gateway.getLastVoucher(this.point, r.draft.voucherType ?? 11);
      if (last.errors?.err?.length || !Number.isSafeInteger(last.cbteNro) || last.cbteNro < 0 ||
          last.ptoVta !== this.point || last.cbteTipo !== (r.draft.voucherType ?? 11))
        throw new Error('ARCA no pudo informar el último número. El borrador sigue sin emitir.');
      r.payload = buildVoucher(r.draft as Draft, this.point, last.cbteNro + 1);
      r.status = 'issuing';
      await this.store.save(r); // Durable write BEFORE making the irreversible network call.
      try {
        const response = await this.gateway.createVoucher(r.payload);
        r.arcaResponse = response;
        const detail = response.response.FeDetResp?.FECAEDetResponse?.[0];
        if (detail?.Resultado === 'A' && response.cae && response.caeFchVto) {
          r.status = 'authorized'; r.cae = response.cae; r.expiration = response.caeFchVto;
          r.detail = JSON.stringify(detail.Observaciones ?? {});
        } else if (detail?.Resultado === 'R' || response.response.FeCabResp?.Resultado === 'R') {
          r.status = 'rejected'; r.detail = JSON.stringify(response.response);
        } else {
          r.status = 'uncertain'; r.detail = 'La respuesta no confirma autorización ni rechazo.';
        }
        await this.store.save(r);
      } catch {
        r.status = 'uncertain'; r.detail = 'Se interrumpió la emisión. Consultar ARCA antes de volver a facturar.';
        await this.store.save(r);
      }
      return r;
    } finally { this.busy = false; }
  }

  async recover(id: string, userId: number): Promise<Record> {
    const r = await this.store.get(id, userId);
    if (!r || r.status !== 'uncertain' || !r.payload) throw new Error('No hay una emisión incierta con ese ID.');
    if (this.busy) throw new Error('Esperá a que termine la operación actual.');
    this.busy = true;
    try {
      const info = await this.gateway.getVoucherInfo(r.payload.CbteDesde, r.payload.PtoVta, r.payload.CbteTipo);
      if (!info || info.errors?.err?.length || !matchesVoucher(info, r.payload))
        throw new Error('ARCA aún no confirma una factura coincidente. La emisión sigue bloqueada: revisá el comprobante en ARCA antes de intervenir la base.');
      r.status = 'authorized'; r.cae = info.codAutorizacion; r.expiration = info.fchVto;
      r.arcaConsultation = info;
      await this.store.save(r);
      return r;
    } finally { this.busy = false; }
  }
}
