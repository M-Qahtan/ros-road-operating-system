import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPgPoolConfig, PostgresRuntimeConfigurationError } from './pg-postgres-pool.js';

const CA = '-----BEGIN CERTIFICATE-----\ntest-ca-material\n-----END CERTIFICATE-----';

function production(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://ros_user:short-lived-token@db.internal:5432/ros',
    DATABASE_SSL_CA_PEM: CA,
    ...overrides
  };
}

test('production PostgreSQL config enables certificate-verifying TLS and bounded pooling', () => {
  const config = buildPgPoolConfig(production({
    DATABASE_POOL_MAX: '12',
    DATABASE_CONNECTION_TIMEOUT_MS: '2500',
    DATABASE_IDLE_TIMEOUT_MS: '15000'
  }));

  assert.equal(config.host, 'db.internal');
  assert.equal(config.port, 5432);
  assert.equal(config.database, 'ros');
  assert.equal(config.user, 'ros_user');
  assert.equal(config.password, 'short-lived-token');
  assert.equal(config.max, 12);
  assert.equal(config.connectionTimeoutMillis, 2500);
  assert.equal(config.idleTimeoutMillis, 15000);
  assert.deepEqual(config.ssl, { ca: CA, rejectUnauthorized: true });
});

test('production PostgreSQL config fails closed without a trusted CA', () => {
  assert.throws(
    () => buildPgPoolConfig(production({ DATABASE_SSL_CA_PEM: '' })),
    /DATABASE_SSL_CA_PEM is required in production/
  );
});

test('rejects ambiguous or unsafe database URL forms', () => {
  assert.throws(
    () => buildPgPoolConfig(production({ DATABASE_URL: 'http://db.internal/ros' })),
    /must use postgres/
  );
  assert.throws(
    () => buildPgPoolConfig(production({ DATABASE_URL: 'postgresql://ros_user:token@db.internal/ros?sslmode=disable' })),
    /query parameters are not allowed/
  );
  assert.throws(
    () => buildPgPoolConfig(production({ DATABASE_URL: 'postgresql://ros_user@db.internal/ros' })),
    /password\/token is required/
  );
});

test('rejects unbounded or malformed pool configuration', () => {
  assert.throws(
    () => buildPgPoolConfig(production({ DATABASE_POOL_MAX: '0' })),
    PostgresRuntimeConfigurationError
  );
  assert.throws(
    () => buildPgPoolConfig(production({ DATABASE_POOL_MAX: '101' })),
    /between 1 and 100/
  );
  assert.throws(
    () => buildPgPoolConfig(production({ DATABASE_CONNECTION_TIMEOUT_MS: 'not-a-number' })),
    /must be an integer/
  );
});

test('non-production may explicitly use an unencrypted local PostgreSQL connection', () => {
  const config = buildPgPoolConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://ros:local-token@127.0.0.1:5432/ros'
  });
  assert.equal(config.ssl, false);
});
