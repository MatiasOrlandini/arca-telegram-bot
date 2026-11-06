import type { ElectronicBillingService } from '@arcasdk/core';
import type { Config } from './config.js';
import { formatError } from './errors.js';

type VerificationService = Pick<ElectronicBillingService, 'getServerStatus' | 'getSalesPoints' | 'getLastVoucher'>;

function arcaErrors(errors: { code: number; msg: string }[]): string {
  const detail = formatError(errors.map(e => `ARCA (${e.code}): ${e.msg}`).join('\n'));
  console.error('Verificación de producción:\n' + detail);
  return detail.slice(0, 2000);
}

// This check deliberately has no access to emission methods or the invoice store.
export async function verifyProduction(config: Pick<Config, 'production' | 'point'>, service: VerificationService): Promise<string> {
  if (!config.production) return 'El bot está en HOMOLOGACIÓN. Para verificar producción, configurá ARCA_ENV=produccion, el certificado y la clave de producción y el punto de venta WS; luego reiniciá el bot. No se realizaron consultas a producción.';
  const lines = ['Verificación de PRODUCCIÓN (sin emitir facturas).'];
  let stage = 'estado de los servidores';
  try {
    const status = await service.getServerStatus();
    const healthy = status.appServer === 'OK' && status.dbServer === 'OK' && status.authServer === 'OK';
    lines.push(`${healthy ? 'OK' : 'ERROR'}: servidores de ARCA.`);
    if (!healthy) return [...lines, 'Algún servidor no está disponible. Reintentá más tarde.'].join('\n');

    stage = 'autenticación y acceso a WSFE';
    const points = await service.getSalesPoints();
    if (points.errors?.err?.length) return [...lines, 'ERROR: consulta autenticada de puntos de venta.',
      arcaErrors(points.errors.err), 'No se emitió ningún comprobante.'].join('\n');
    lines.push('OK: certificado autenticado y acceso autorizado a WSFE.');
    const point = points.resultGet?.ptoVenta?.find(p => p.nro === config.point);
    if (!point) return [...lines, `ERROR: punto de venta ${config.point} no encontrado entre los habilitados para WSFE.`, 'Revisá ARCA_PUNTO_VENTA y el alta del punto para Web Services.'].join('\n');
    const deregistration = point.fechaBaja?.trim().toUpperCase() ?? '';
    const inactive = !['', 'NULL', '00000000'].includes(deregistration);
    const supportsCae = /^CAE(?:\s*-\s*Monotributo)?$/i.test(point.emisionTipo.trim());
    if (point.bloqueado.trim().toUpperCase() !== 'N' || inactive || !supportsCae)
      return [...lines, `ERROR: punto de venta ${config.point} bloqueado, dado de baja o no habilitado para emisión por CAE.`,
        'Valores devueltos por ARCA:',
        JSON.stringify({ numero: point.nro, tipoEmision: point.emisionTipo, bloqueado: point.bloqueado, fechaBaja: point.fechaBaja ?? null }, null, 2),
        'No se emitió ningún comprobante.'].join('\n');
    lines.push(`OK: punto de venta ${config.point} activo para CAE.`);

    stage = 'consulta del último comprobante';
    const last = await service.getLastVoucher(config.point, 11);
    if (last.errors?.err?.length) return [...lines, 'ERROR: consulta del último comprobante.',
      arcaErrors(last.errors.err), 'No se emitió ningún comprobante.'].join('\n');
    if (!Number.isSafeInteger(last.cbteNro) || last.cbteNro < 0 ||
        last.ptoVta !== config.point || last.cbteTipo !== 11)
      return [...lines, 'ERROR: ARCA no devolvió una numeración válida de Factura C para este punto.'].join('\n');
    lines.push(`OK: última Factura C autorizada: ${last.cbteNro}.`,
      `Próximo número según esta consulta: ${last.cbteNro + 1} (no reservado).`,
      'No se emitió ningún comprobante ni se consumió numeración.',
      'Estas consultas no garantizan la autorización de una futura factura; ARCA también valida sus datos.');
    return lines.join('\n');
  } catch (error) {
    console.error(`Verificación de producción: ${stage}\n` + formatError(error));
    // Never return raw SDK exceptions: they can contain tokens or SOAP bodies.
    return [...lines, `ERROR: no se pudo completar ${stage}.`,
      'Revisá la conexión, el certificado y su vigencia, la clave correspondiente, el CUIT y los permisos para WSFE.',
      'No se emitió ningún comprobante.'].join('\n');
  }
}
