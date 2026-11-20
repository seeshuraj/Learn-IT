import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dbSslConfig } from '../dbSsl.js';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIU\n-----END CERTIFICATE-----';

test('with a CA certificate the server certificate is verified against it', () => {
  assert.deepEqual(dbSslConfig({ DATABASE_CA_CERT: PEM }), { ca: PEM, rejectUnauthorized: true });
});

test('a CA certificate pasted with escaped newlines still works', () => {
  const escaped = PEM.replace(/\n/g, '\\n');
  assert.deepEqual(dbSslConfig({ DATABASE_CA_CERT: escaped }), { ca: PEM, rejectUnauthorized: true });
});

test('something that is not a PEM certificate is refused instead of silently ignored', () => {
  assert.throws(() => dbSslConfig({ DATABASE_CA_CERT: 'not a cert' }), /DATABASE_CA_CERT/);
});

test('without a CA the connection stays encrypted but unverified', () => {
  assert.deepEqual(dbSslConfig({}), { rejectUnauthorized: false });
  assert.deepEqual(dbSslConfig({ DATABASE_CA_CERT: '  ' }), { rejectUnauthorized: false });
});

test('a local database can turn TLS off explicitly', () => {
  assert.equal(dbSslConfig({ DATABASE_SSL: 'disable' }), false);
});

test('TLS can never be turned off in production', () => {
  assert.throws(() => dbSslConfig({ DATABASE_SSL: 'disable', NODE_ENV: 'production' }), /production/);
});
