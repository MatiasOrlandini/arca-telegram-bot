import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Arca } from '@arcasdk/core';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { createBot } from './bot.js';
import { IssuerManager } from './issuer.js';
import { formatError } from './errors.js';

async function main() {
  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true });
  const store = new Store(config.databaseUrl, config.context, config.databaseSsl);
  await store.open();
  const arca = new Arca({ cuit: Number(config.cuit), cert: config.cert, key: config.key,
    production: config.production, useHttpsAgent: config.production,
    ticketPath: join(config.dataDir, 'tickets') });
  const issuer = new IssuerManager(config.issuer, store,
    cuit => arca.registerScopeFiveService.getTaxpayerDetails(cuit));
  await issuer.initialize();
  const bot = createBot(config, store, arca.electronicBillingService, issuer);
  const shutdown = () => { if (bot.isRunning()) void bot.stop(); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await bot.api.setMyCommands([
      { command: 'factura', description: 'Crear una factura C' },
      { command: 'factura_fija', description: 'Facturar al receptor fijo: importe y fechas' },
      { command: 'nota_credito', description: 'Crear una Nota de Crédito C total por ID' },
      { command: 'emisor', description: 'Ver o completar mis datos fiscales' },
      { command: 'cancelar', description: 'Cancelar un borrador' },
      { command: 'historial', description: 'Ver últimas operaciones' },
      { command: 'pdf', description: 'Descargar una factura por ID' },
      { command: 'respuesta', description: 'Ver la respuesta de ARCA por ID' },
      { command: 'recuperar', description: 'Consultar una emisión pendiente por ID' },
      { command: 'estado', description: 'Consultar el estado de ARCA' },
      { command: 'verificar_produccion', description: 'Verificar producción sin emitir facturas' },
      { command: 'miid', description: 'Ver mi ID de Telegram' },
    ]);
    await bot.start({ onStart: () => console.log(`Bot activo en ${config.production ? 'producción' : 'homologación'}.`) });
  } finally { await store.close(); }
}
main().catch(error => {
  // Do not print connection strings, tokens, private keys or SOAP bodies.
  console.error('No se pudo iniciar el bot. Revisá .env, certificados y PostgreSQL.\n' + formatError(error));
  process.exit(1);
});
