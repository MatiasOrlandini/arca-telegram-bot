import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arcaWebTemplate } from '../src/arca-template.js';
import { invoiceData } from '../src/pdf.js';
import { buildVoucher } from '../src/invoice.js';
import { draft, record } from './fixtures.js';

test('la plantilla trata los datos del receptor y detalle como texto, sin ejecutar HTML', () => {
  const r = record(); r.status = 'authorized'; r.payload = buildVoucher(draft(), 1, 11);
  r.cae = '12345678901234'; r.expiration = '20261012';
  const data = invoiceData(r, { point: 1, issuer: { cuit: '20123456786', razonSocial: 'Emisor', domicilioComercial: 'Prueba', condicionIva: 'Responsable Monotributo', iibb: 'Exento', fechaInicioActividades: '20260101' } });
  data.receptor.razonSocial = '<img src="https://example.com" onerror="alert(1)">';
  data.items[0].descripcion = '<script>fetch("https://example.com")</script>';
  const html = arcaWebTemplate({ data, options: { pageSize: 'A4', margin: 5.3, includeQr: true } });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src="https://example.com"'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
});
