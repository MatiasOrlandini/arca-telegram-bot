import { buildVoucher, displayDate, money, parseAmount, parseDate, parseDocument, today, type Draft } from './invoice.js';
import type { Record } from './store.js';
import { UserError } from './errors.js';

export interface IvaOption { id: number; desc: string }
export const paymentMethods = ['Contado', 'Efectivo', 'Transferencia bancaria', 'Tarjeta de débito', 'Tarjeta de crédito', 'Cuenta corriente', 'Cheque', 'Otro'] as const;
export const prompts: { [step: string]: string } = {
  documentType: 'Documento del receptor: escribí CUIT o DNI.',
  documentNumber: 'Ingresá el número de documento del receptor.',
  name: 'Nombre y apellido o razón social del receptor.',
  address: 'Domicilio del receptor.',
  description: 'Descripción del producto o servicio (hasta 500 caracteres).',
  amount: 'Importe TOTAL en pesos, sin separador de miles. Ejemplo: 15000,50.',
  paymentMethod: 'Forma de pago: ingresá el número de una opción:\n' + paymentMethods.map((label, index) => `${index + 1}: ${label}`).join('\n'),
  creditReason: 'Motivo de la nota de crédito TOTAL (hasta 300 caracteres). Conserva receptor e importe de la factura original. Antes de continuar, verificá que esa factura no tenga notas de crédito emitidas fuera del bot.',
  concept: 'Concepto: 1 = Productos, 2 = Servicios, 3 = Productos y servicios.',
  serviceFrom: 'Fecha de inicio del servicio (AAAA-MM-DD).',
  serviceTo: 'Fecha de fin del servicio (AAAA-MM-DD).',
  paymentDue: 'Fecha de vencimiento de pago (AAAA-MM-DD).',
};

function text(value: string, max: number): string {
  const v = value.trim();
  if (!v || v.length > max || /[\x00-\x1f]/.test(v)) throw new UserError(`Ingresá un texto de entre 1 y ${max} caracteres, en una sola línea.`);
  return v;
}

export function fixedServiceDraft(settings: { cuit: string; name: string; address: string; ivaId: string; description: string; paymentMethod: string } | undefined,
  options: IvaOption[]): Partial<Draft> {
  if (!settings) throw new UserError('Configurá los datos de /factura_fija en .env.');
  for (const [key, value] of Object.entries({ RECEPTOR_CUIT: settings.cuit, RECEPTOR_RAZON_SOCIAL: settings.name,
    RECEPTOR_DOMICILIO: settings.address, RECEPTOR_IVA_ID: settings.ivaId, FACTURA_FIJA_DESCRIPCION: settings.description }))
    if (!value.trim()) throw new UserError(`Falta configurar ${key} en .env para /factura_fija.`);
  const iva = options.find(o => String(o.id) === settings.ivaId.trim());
  if (!iva) throw new UserError('RECEPTOR_IVA_ID no corresponde a una condición IVA válida para Factura C.');
  const paymentMethod = paymentMethods.find(label => label.toLocaleLowerCase('es-AR') === settings.paymentMethod.trim().toLocaleLowerCase('es-AR'));
  if (!paymentMethod) throw new UserError('FACTURA_FIJA_FORMA_PAGO no es válida. Usá Contado, Efectivo, Transferencia bancaria, Tarjeta de débito, Tarjeta de crédito, Cuenta corriente, Cheque u Otro.');
  return { fixedService: true, documentType: 80, documentNumber: parseDocument(settings.cuit, 80),
    name: text(settings.name, 150), address: text(settings.address, 200), ivaId: iva.id, ivaLabel: iva.desc,
    description: text(settings.description, 500), paymentMethod, concept: 2, date: today() };
}

export function advance(r: Record, value: string, options: IvaOption[]): void {
  if (r.status !== 'draft' || r.step === 'confirm') throw new UserError('El borrador ya está completo. Confirmá con el botón o usá /cancelar.');
  const d = r.draft;
  switch (r.step) {
    case 'creditReason': d.description = text(value, 300); r.step = 'confirm'; break;
    case 'documentType': {
      const type = value.trim().toUpperCase();
      if (!['CUIT', 'DNI'].includes(type)) throw new UserError('Escribí CUIT o DNI.');
      d.documentType = type === 'CUIT' ? 80 : 96; r.step = 'documentNumber'; break;
    }
    case 'documentNumber': d.documentNumber = parseDocument(value, d.documentType!); r.step = 'name'; break;
    case 'name': d.name = text(value, 150); r.step = 'address'; break;
    case 'address': d.address = text(value, 200); r.step = 'iva'; break;
    case 'iva': {
      const option = options.find(o => String(o.id) === value.trim());
      if (!option) throw new UserError('Ingresá un código de la lista de condiciones IVA.');
      if (d.documentType === 96 && option.id !== 5) throw new UserError('Para este flujo con DNI, seleccioná Consumidor Final. Para otras condiciones, usá CUIT.');
      d.ivaId = option.id; d.ivaLabel = option.desc; r.step = 'description'; break;
    }
    case 'description': d.description = text(value, 500); r.step = 'amount'; break;
    case 'amount': d.cents = parseAmount(value); r.step = d.fixedService ? 'serviceFrom' : 'paymentMethod'; break;
    case 'paymentMethod': {
      const input = value.trim();
      const option = /^[1-8]$/.test(input) ? paymentMethods[Number(input) - 1] :
        paymentMethods.find(label => label.toLocaleLowerCase('es-AR') === input.toLocaleLowerCase('es-AR'));
      if (!option) throw new UserError('Elegí una forma de pago de la lista, ingresando su número.');
      d.paymentMethod = option; r.step = 'concept'; break;
    }
    case 'concept': {
      if (!/^[123]$/.test(value.trim())) throw new UserError('El concepto debe ser 1, 2 o 3.');
      d.concept = Number(value.trim()); d.date = today(); r.step = d.concept === 1 ? 'confirm' : 'serviceFrom'; break;
    }
    case 'serviceFrom': d.serviceFrom = parseDate(value); r.step = 'serviceTo'; break;
    case 'serviceTo': {
      const date = parseDate(value);
      if (date < d.serviceFrom!) throw new UserError('El fin del servicio debe ser igual o posterior al inicio.');
      d.serviceTo = date; r.step = 'paymentDue'; break;
    }
    case 'paymentDue': {
      const date = parseDate(value);
      if (date < d.date!) throw new UserError('El vencimiento de pago no puede ser anterior a la factura.');
      d.paymentDue = date; r.step = 'confirm'; break;
    }
    default: throw new UserError('Paso desconocido. Cancelá el borrador y comenzá de nuevo.');
  }
  if (r.step === 'confirm') buildVoucher(d as Draft, 1, 1);
}

export function summary(r: Record, point: number, production: boolean): string {
  const d = r.draft as Draft;
  return [
    `${d.voucherType === 13 ? 'Nota de Crédito C TOTAL' : 'Factura C'} · ${production ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN (sin validez fiscal)'}`,
    ...(d.associatedVoucher ? [`Factura asociada: ${String(d.associatedVoucher.PtoVta).padStart(5, '0')}-${String(d.associatedVoucher.Nro).padStart(8, '0')}`] : []),
    `Punto de venta: ${point} · Fecha: ${displayDate(d.date)}`,
    `Receptor: ${d.name}`, `${d.documentType === 80 ? 'CUIT' : 'DNI'}: ${d.documentNumber}`,
    `Domicilio: ${d.address}`, `Condición IVA: ${d.ivaLabel}`,
    `Detalle: ${d.description}`, `Concepto: ${['', 'Productos', 'Servicios', 'Productos y servicios'][d.concept]}`,
    `Forma de pago: ${d.paymentMethod ?? 'Contado'}`,
    ...(d.concept !== 1 ? [`Servicio: ${displayDate(d.serviceFrom!)} al ${displayDate(d.serviceTo!)}`, `Vencimiento de pago: ${displayDate(d.paymentDue!)}`] : []),
    `TOTAL: ${money(d.cents)}`, `ID: ${r.id}`,
    'Al confirmar se solicitará la autorización a ARCA.',
  ].join('\n');
}
