import type { TaxpayerDetailsDto } from '@arcasdk/core';
import type { EmisorData } from '@arcasdk/pdf';
import { parseDate, today, displayDate } from './invoice.js';
import { UserError } from './errors.js';

export type IssuerField = 'razonSocial' | 'domicilioComercial' | 'iibb' | 'fechaInicioActividades';
export interface IssuerStorage {
  getIssuer(): Promise<EmisorData | undefined>;
  saveIssuer(data: EmisorData): Promise<void>;
}
const object = (v: unknown): { [key: string]: unknown } => v && typeof v === 'object' && !Array.isArray(v) ? v as { [key: string]: unknown } : {};
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';

export function issuerFromPadron(person: TaxpayerDetailsDto | null, cuit: string): Partial<EmisorData> {
  if (!person || person.errorConstancia?.error) return {};
  // A5 preserves the SOAP fields at runtime, though its public DTO does not
  // declare apellido/nombre/razonSocial/domicilioFiscal.
  const general = object(person.datosGenerales);
  if (String(person.idPersona ?? general.idPersona ?? '') !== cuit) return {};
  const name = text(general.razonSocial) || [text(general.apellido), text(general.nombre)].filter(Boolean).join(' ');
  const fiscal = object(general.domicilioFiscal);
  const direction = text(fiscal.direccion);
  const locality = [text(fiscal.localidad), text(fiscal.descripcionProvincia)].filter(Boolean).join(', ');
  return {
    ...(name ? { razonSocial: name } : {}),
    ...(direction ? { domicilioComercial: direction + (locality ? ` - ${locality}` : '') } : {}),
  };
}

export const issuerPrompts: { [K in IssuerField]: string } = {
  razonSocial: 'ARCA no informó tu nombre o razón social. Ingresalo para el PDF.',
  domicilioComercial: 'ARCA no informó el domicilio. Ingresá tu domicilio comercial para el PDF.',
  iibb: 'Ingresá tu número de Ingresos Brutos tal como figura en tus facturas. Si corresponde, escribí Exento o No inscripto.',
  fechaInicioActividades: 'Ingresá la fecha de inicio de actividades que figura en tus facturas (AAAA-MM-DD).',
};

export class IssuerManager {
  private data: EmisorData;
  private padronResponse: TaxpayerDetailsDto | null | undefined;
  notice = '';
  constructor(private seed: EmisorData, private storage: IssuerStorage,
    private lookup: (cuit: number) => Promise<TaxpayerDetailsDto | null>) {
    this.data = { ...seed };
  }
  get current(): EmisorData { return { ...this.data }; }
  get missing(): IssuerField[] {
    return (['razonSocial', 'domicilioComercial', 'iibb', 'fechaInicioActividades'] as IssuerField[]).filter(k => !this.data[k]?.trim());
  }
  async initialize() {
    const saved = await this.storage.getIssuer();
    let automatic: Partial<EmisorData> = {};
    this.padronResponse = undefined;
    try {
      this.padronResponse = await this.lookup(Number(this.seed.cuit));
      automatic = issuerFromPadron(this.padronResponse, this.seed.cuit);
      this.notice = automatic.razonSocial || automatic.domicilioComercial
        ? 'Datos consultados en el padrón de ARCA. El domicilio fiscal se usa como domicilio comercial; podés reemplazarlo con EMISOR_DOMICILIO en .env.'
        : 'El padrón no devolvió datos utilizables para tu CUIT. Se usan los datos guardados o configurados; el bot pedirá los faltantes.';
    } catch {
      this.notice = 'No se pudo consultar el padrón. Revisá la autorización de ws_sr_padron_a5 en ARCA. Se usan los datos guardados o configurados; el bot pedirá los faltantes.';
    }
    for (const k of ['razonSocial', 'domicilioComercial', 'iibb', 'fechaInicioActividades'] as IssuerField[]) {
      this.data[k] = this.seed[k] || automatic[k] || (saved?.cuit === this.seed.cuit ? saved[k] : '') || '';
    }
    await this.storage.saveIssuer(this.current);
  }
  complete(): EmisorData {
    if (this.missing.length) throw new UserError('Faltan datos del emisor. Usá /emisor para completarlos antes de emitir.');
    return this.current;
  }
  async supply(field: IssuerField, value: string) {
    if (!this.missing.includes(field)) throw new UserError('Ese dato ya se completó. Consultá /emisor para ver el estado actual.');
    let normalized = value.trim();
    if (field === 'fechaInicioActividades') {
      normalized = parseDate(normalized);
      if (normalized > today()) throw new UserError('La fecha de inicio de actividades no puede estar en el futuro.');
    } else if (!normalized || normalized.length > (field === 'iibb' ? 50 : 200) || /[\x00-\x1f]/.test(normalized)) {
      throw new UserError('Ingresá un texto válido en una sola línea.');
    }
    const updated = { ...this.data, [field]: normalized };
    await this.storage.saveIssuer(updated);
    this.data = updated;
  }
  summary(): string {
    return [
      `Emisor · CUIT ${this.data.cuit}`,
      `Razón social: ${this.data.razonSocial || 'Pendiente'}`,
      `Domicilio comercial: ${this.data.domicilioComercial || 'Pendiente'}`,
      `Condición IVA: ${this.data.condicionIva}`,
      `Ingresos Brutos: ${this.data.iibb || 'Pendiente'}`,
      `Inicio de actividades: ${this.data.fechaInicioActividades ? displayDate(this.data.fechaInicioActividades) : 'Pendiente'}`,
      this.notice,
    ].filter(Boolean).join('\n');
  }
  // Temporary diagnostic: show only the SDK result, never SOAP/auth exceptions.
  diagnosticSummary(): string {
    const header = this.summary() + '\n\nRespuesta del padrón (SDK, diagnóstico temporal):\n';
    const response = this.padronResponse === undefined ? 'Sin respuesta: la consulta falló.' :
      JSON.stringify(this.padronResponse, (key, value) =>
        /token|sign|password|secret|cert|privatekey|authorization/i.test(key) ? '[OCULTO]' : value, 2);
    const suffix = '\n[Respuesta recortada por el límite de Telegram]';
    const available = Math.max(0, 4000 - header.length);
    return header + (response.length <= available ? response : response.slice(0, Math.max(0, available - suffix.length)) + suffix);
  }
}
