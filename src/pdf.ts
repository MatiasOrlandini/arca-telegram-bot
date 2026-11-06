import { InvoicePdfGenerator, type InvoiceData } from '@arcasdk/pdf';
import type { Config } from './config.js';
import type { Record, Repository } from './store.js';
import type { Draft } from './invoice.js';
import { PDFDocument, rgb } from 'pdf-lib';
import { arcaWebTemplate } from './arca-template.js';

export async function generateInvoicePdf(data: InvoiceData, production: boolean): Promise<Buffer> {
  const generator = new InvoicePdfGenerator({
    template: arcaWebTemplate, margin: 5.3,
    copies: ['ORIGINAL', 'DUPLICADO', 'TRIPLICADO'],
    ...(production ? {} : { footerText: 'HOMOLOGACIÓN - SIN VALIDEZ FISCAL' }),
  });
  const document = await PDFDocument.load(await generator.generate(data));
  // The SDK always adds a generic Chrome footer. The web reference has its
  // page number in the authorization block; clear only that extra footer band.
  for (const page of document.getPages()) {
    page.drawRectangle({ x: 0, y: 0, width: page.getWidth(), height: 31, color: rgb(1, 1, 1) });
  }
  return Buffer.from(await document.save());
}

export function invoiceData(r: Record, config: Pick<Config, 'issuer' | 'point'>): InvoiceData {
  if (r.status !== 'authorized' || !r.payload || !r.cae || !r.expiration) throw new Error('La factura no está autorizada.');
  const d = r.draft as Draft;
  return {
    emisor: r.issuer ?? config.issuer,
    receptor: { razonSocial: d.name, domicilio: d.address, condicionIva: d.ivaLabel,
      documentoTipo: d.documentType === 80 ? 'CUIT' : 'DNI', documentoNro: String(d.documentNumber) },
    cbteTipo: r.payload.CbteTipo, cbteLetra: 'C', puntoVenta: r.payload.PtoVta,
    cbteDescripcion: r.payload.CbteTipo === 13 ? 'NOTA DE CRÉDITO' : 'FACTURA',
    cbtesAsociados: r.payload.CbtesAsoc?.map(a => ({ tipo: a.Tipo, puntoVenta: a.PtoVta, numero: a.Nro, cuit: a.Cuit, fecha: a.CbteFch })),
    cbteDesde: r.payload.CbteDesde, cbteHasta: r.payload.CbteHasta, cbteFecha: d.date,
    concepto: d.concept, moneda: 'PES', cotizacion: 1, condicionVenta: d.paymentMethod ?? 'Contado',
    fechaServicioDesde: d.serviceFrom, fechaServicioHasta: d.serviceTo, fechaVtoPago: d.paymentDue,
    items: [{ descripcion: d.description, cantidad: 1, unidadMedida: 'unidades', precioUnitario: d.cents / 100, subtotal: d.cents / 100 }],
    importeNetoGravado: d.cents / 100, importeIva: 0, importeTotal: d.cents / 100,
    cae: r.cae, caeFechaVencimiento: r.expiration,
  };
}

export async function getPdf(r: Record, config: Config, store: Repository): Promise<Buffer> {
  const data = invoiceData(r, config);
  const cached = await store.getPdf(r.id, r.userId);
  if (cached) return cached;
  const buffer = await generateInvoicePdf(data, config.production);
  await store.savePdf(r.id, r.userId, buffer);
  return buffer;
}
