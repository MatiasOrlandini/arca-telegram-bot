import type { InvoiceTemplateProps } from '@arcasdk/pdf';
import { arcaLogo } from './arca-logo.js';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]!));
const amount = (n: number) => n.toFixed(2).replace('.', ',');
const date = (v?: string) => v ? `${v.slice(6, 8)}/${v.slice(4, 6)}/${v.slice(0, 4)}` : '';

/** Layout measured against a Comprobantes en Línea factura C supplied by the user. */
export function arcaWebTemplate({ data: d, options, qrDataUrl }: InvoiceTemplateProps): string {
  const rows = d.items.map(i => `<tr><td>${escape(i.codigo)}</td><td class="description">${escape(i.descripcion)}</td>
    <td class="number">${amount(i.cantidad)}</td><td>${escape(i.unidadMedida)}</td>
    <td class="number">${amount(i.precioUnitario)}</td><td class="number">${amount(i.bonificacion ?? 0)}</td>
    <td class="number">${amount(i.importeBonificacion ?? 0)}</td><td class="number">${amount(i.subtotal)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="UTF-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #000; }
    body { padding-top: 7.5pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .paper { position: relative; width: 100%; height: 745pt; }
    .banner { height: 28pt; border: .6pt solid #000; text-align: center; font-size: 14pt; font-weight: bold; padding-top: 5pt; }
    .header { position: relative; height: 119pt; border: .6pt solid #000; border-top: 0; }
    .divider { position: absolute; left: 50%; top: 0; height: 119pt; border-left: .6pt solid #000; }
    .letter { position: absolute; left: calc(50% - 24pt); top: 0; width: 48pt; height: 41pt; background: white;
      border: .6pt solid #000; border-top: 0; text-align: center; }
    .letter span { font-weight: bold; font-size: 25pt; line-height: 27pt; }
    .letter b { display: block; font-size: 8pt; }
    .issuer-name { position: absolute; left: 6pt; top: 17pt; width: 44%; text-align: center; font-size: 10pt; font-weight: bold; }
    .issuer-data { position: absolute; left: 6pt; top: 58pt; width: 47%; }
    .issuer-row { display: flex; margin-bottom: 13pt; gap: 5pt; }
    .issuer-row b { flex-shrink: 0; }
    .issuer-row.address { margin-bottom: 5pt; }
    .issuer-row.address span { overflow-wrap: anywhere; }
    .invoice-data { position: absolute; left: 57.5%; right: 7pt; top: 9pt; }
    .invoice-title { font-size: 18pt; font-weight: bold; margin-bottom: 10pt; }
    .invoice-title.credit { font-size: 15pt; }
    .associated { margin-top: 3pt; font-size: 8pt; }
    .invoice-number { display: flex; justify-content: space-between; font-weight: bold; margin-bottom: 5pt; white-space: nowrap; }
    .invoice-date { font-weight: bold; margin-bottom: 12pt; }
    .fiscal-row { font-size: 9pt; margin-bottom: 2pt; }
    .period { height: 23pt; border: .6pt solid #000; border-top: 0; display: flex; justify-content: space-between;
      align-items: center; padding: 0 6pt; font-size: 10pt; }
    .period b { margin-right: 8pt; }
    .receptor { min-height: 63pt; margin-top: 1pt; border: .6pt solid #000; padding: 3pt 6pt 8pt; }
    .receptor-row { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 8pt; font-size: 8pt; }
    .receptor-name { width: 64%; }
    .receptor-address { width: 49%; }
    .sale { margin-top: 11pt; font-size: 8pt; }
    .sale b { margin-right: 16pt; }
    .items { margin-top: 1.5pt; border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 8pt; }
    .items th { background: #ccc; border: .6pt solid #000; height: 18pt; padding: 2pt 3pt; white-space: nowrap; }
    .items td { padding: 4pt 2pt 0; vertical-align: top; }
    .items .description { overflow-wrap: anywhere; }
    .number { text-align: right; }
    .totals { position: absolute; top: 493.5pt; width: 100%; height: 94.5pt; border: .8pt solid #000; padding: 36pt 8pt 5pt; }
    .total-row { display: flex; justify-content: flex-end; font-weight: bold; margin-bottom: 7pt; font-size: 9pt; }
    .total-label { text-align: right; }
    .total-amount { width: 82pt; text-align: right; }
    .authorization { position: absolute; top: 623pt; width: 100%; height: 90pt; }
    .qr { position: absolute; left: 11pt; top: 12pt; width: 68pt; height: 68pt; }
    .brand { position: absolute; left: 98pt; top: 4pt; }
    .brand img { display: block; width: 56pt; height: auto; }
    .authorized { margin-top: 9pt; font-size: 9pt; font-weight: bold; font-style: italic; }
    .disclaimer { margin-top: 10pt; font-size: 6pt; font-weight: bold; font-style: italic; white-space: nowrap; }
    .page-number { position: absolute; left: 46%; top: 4pt; font-size: 10pt; font-weight: bold; }
    .cae { position: absolute; right: 26pt; top: 1pt; text-align: right; font-size: 10pt; }
    .cae div { margin-bottom: 4pt; }
    .warning { position: absolute; top: 728pt; width: 100%; text-align: center; font-size: 8pt; font-weight: bold; }
  </style></head><body><div class="paper">
    <div class="banner">${escape(options.copy ?? 'ORIGINAL')}</div>
    <div class="header"><div class="divider"></div>
      <div class="letter"><span>${escape(d.cbteLetra)}</span><b>COD. ${String(d.cbteTipo).padStart(3, '0')}</b></div>
      <div class="issuer-name">${escape(d.emisor.razonSocial)}</div>
      <div class="issuer-data">
        <div class="issuer-row"><b>Razón Social:</b><span>${escape(d.emisor.razonSocial)}</span></div>
        <div class="issuer-row address"><b>Domicilio Comercial:</b><span>${escape(d.emisor.domicilioComercial)}</span></div>
        <div class="issuer-row"><b>Condición frente al IVA:</b><strong>${escape(d.emisor.condicionIva)}</strong></div>
      </div>
      <div class="invoice-data"><div class="invoice-title${d.cbteTipo === 13 ? ' credit' : ''}">${escape(d.cbteDescripcion ?? 'FACTURA')}</div>
        <div class="invoice-number"><span>Punto de Venta: &nbsp; ${String(d.puntoVenta).padStart(5, '0')}</span><span>Comp. Nro: &nbsp; ${String(d.cbteDesde).padStart(8, '0')}</span></div>
        <div class="invoice-date">Fecha de Emisión: &nbsp; ${date(d.cbteFecha)}</div>
        <div class="fiscal-row"><b>CUIT:</b> ${escape(d.emisor.cuit)}</div>
        <div class="fiscal-row"><b>Ingresos Brutos:</b> &nbsp; ${escape(d.emisor.iibb)}</div>
        <div class="fiscal-row"><b>Fecha de Inicio de Actividades:</b> &nbsp; ${date(d.emisor.fechaInicioActividades)}</div>
      </div>
    </div>
    ${d.concepto !== 1 ? `<div class="period"><span><b>Período Facturado Desde:</b> ${date(d.fechaServicioDesde)}</span><span><b>Hasta:</b> ${date(d.fechaServicioHasta)}</span><span><b>Fecha de Vto. para el pago:</b> ${date(d.fechaVtoPago)}</span></div>` : ''}
    <div class="receptor">
      <div class="receptor-row"><span><b>${escape(d.receptor.documentoTipo)}:</b> ${escape(d.receptor.documentoNro)}</span><span class="receptor-name"><b>Apellido y Nombre / Razón Social:</b> ${escape(d.receptor.razonSocial)}</span></div>
      <div class="receptor-row"><span><b>Condición frente al IVA:</b> &nbsp; ${escape(d.receptor.condicionIva)}</span><span class="receptor-address"><b>Domicilio:</b> ${escape(d.receptor.domicilio)}</span></div>
      <div class="sale"><b>Condición de venta:</b> ${escape(d.condicionVenta)}</div>
      ${d.cbtesAsociados?.map(a => `<div class="associated"><b>Comprobante asociado:</b> Factura C ${String(a.puntoVenta).padStart(5, '0')}-${String(a.numero).padStart(8, '0')}</div>`).join('') ?? ''}
    </div>
    <table class="items"><colgroup><col style="width:7%"><col style="width:25%"><col style="width:11.5%"><col style="width:7.5%"><col style="width:14%"><col style="width:5.7%"><col style="width:12%"><col style="width:17.3%"></colgroup>
      <thead><tr><th>Código</th><th style="text-align:left">Producto / Servicio</th><th>Cantidad</th><th>U. Medida</th><th>Precio Unit.</th><th>% Bonif</th><th>Imp. Bonif.</th><th>Subtotal</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="total-row"><span class="total-label">Subtotal: $</span><span class="total-amount">${amount(d.importeTotal - (d.importeTributos ?? 0))}</span></div>
      <div class="total-row"><span class="total-label">Importe Otros Tributos: $</span><span class="total-amount">${amount(d.importeTributos ?? 0)}</span></div>
      <div class="total-row"><span class="total-label">Importe Total: $</span><span class="total-amount">${amount(d.importeTotal)}</span></div>
    </div>
    <div class="authorization">${qrDataUrl ? `<img class="qr" src="${escape(qrDataUrl)}">` : ''}
      <div class="brand"><img src="${arcaLogo}"><div class="authorized">Comprobante Autorizado</div><div class="disclaimer">Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación</div></div>
      <div class="page-number">Pág. 1/1</div>
      <div class="cae"><div><b>CAE N°:</b> &nbsp; ${escape(d.cae)}</div><div><b>Fecha de Vto. de CAE:</b> &nbsp; ${date(d.caeFechaVencimiento)}</div></div>
    </div>
    ${options.footerText ? `<div class="warning">${escape(options.footerText)}</div>` : ''}
  </div></body></html>`;
}
