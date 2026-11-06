export class UserError extends Error {}

export function formatError(error: unknown): string {
  const seen = new Set<unknown>();
  function describe(value: unknown, depth = 0): string {
    if (depth > 4 || seen.has(value)) return '[Causa omitida]';
    if (!(value instanceof Error)) return typeof value === 'string' ? value : 'Error sin detalle';
    seen.add(value);
    const code = (value as Error & { code?: unknown }).code;
    return (value.stack || `${value.name}: ${value.message}`) +
      (typeof code === 'string' || typeof code === 'number' ? `\nCódigo: ${code}` : '') +
      (value.cause ? `\nCausa: ${describe(value.cause, depth + 1)}` : '');
  }
  let result = describe(error);
  // Raw SOAP bodies and credentials can appear inside SDK error messages.
  result = result.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[PEM OCULTO]')
    .replace(/<(?:[\w.-]+:)?(?:Envelope|Auth|token|sign)\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?(?:Envelope|Auth|token|sign)>/gi, '[SOAP/AUTH OCULTO]')
    .replace(/(?:bot)?\d{5,}:[A-Za-z0-9_-]{20,}/g, '[TOKEN TELEGRAM OCULTO]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[CREDENCIALES OCULTAS]@')
    .replace(/((?:token|sign|password|secret|authorization)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[OCULTO]');
  for (const [name, value] of Object.entries(process.env)) {
    if (value && /TOKEN|PASSWORD|SECRET|DATABASE_URL|ARCA_(?:CERT|KEY)$/.test(name))
      result = result.split(value).join('[OCULTO]');
  }
  return result;
}
