import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatError } from '../src/errors.js';

test('consola conserva mensaje, código, traza y causa sin credenciales', () => {
  const error = Object.assign(new Error('Fallo WSFE', { cause: new Error('dh key too small') }), { code: 'EPROTO' });
  const text = formatError(error);
  assert.match(text, /Fallo WSFE/); assert.match(text, /EPROTO/); assert.match(text, /dh key too small/);
  assert.match(text, /at /);
  const secret = formatError(new Error('postgresql://user:pass@localhost/db https://api.telegram.org/bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_123456/getMe <soap:Envelope><token>secret</token></soap:Envelope> -----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----'));
  assert.doesNotMatch(secret, /user:pass|ABCDEFGHIJKLMNOPQRSTUVWXYZ|<token>|\nprivate\n/);
});
