import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from '../src/config/index.js';

describe('configuration loading', () => {
  it('boots on defaults when nothing is set', () => {
    const config = loadConfig({});

    assert.equal(config.env, 'development');
    assert.equal(config.port, 4000);
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.logLevel, 'info');
    assert.equal(config.database.port, 5432);
  });

  it('reads values from the environment', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'warn',
      JWT_SECRET: 'a'.repeat(32),
    });

    assert.equal(config.env, 'production');
    assert.equal(config.isProduction, true);
    assert.equal(config.port, 8080);
    assert.equal(config.logLevel, 'warn');
  });

  it('assembles a database url from the discrete POSTGRES_* values', () => {
    const config = loadConfig({
      POSTGRES_HOST: 'postgres',
      POSTGRES_PORT: '5433',
      POSTGRES_USER: 'app',
      POSTGRES_PASSWORD: 'p@ss word',
      POSTGRES_DB: 'obs',
    });

    // The password is url-encoded, so punctuation cannot corrupt the url.
    assert.equal(config.database.url, 'postgresql://app:p%40ss%20word@postgres:5433/obs');
  });

  it('lets an explicit DATABASE_URL win over the parts', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://managed:secret@db.example.com:5432/prod',
      POSTGRES_HOST: 'ignored',
    });

    assert.equal(config.database.url, 'postgresql://managed:secret@db.example.com:5432/prod');
  });

  it('rejects a port that is not a valid integer', () => {
    assert.throws(() => loadConfig({ PORT: 'not-a-number' }), ConfigError);
    assert.throws(() => loadConfig({ PORT: '99999' }), ConfigError);
  });

  it('rejects an unknown NODE_ENV', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'staging' }), ConfigError);
  });

  it('reports every problem at once rather than only the first', () => {
    try {
      loadConfig({ PORT: '0', NODE_ENV: 'staging', LOG_LEVEL: 'chatty' });
      assert.fail('expected ConfigError');
    } catch (err) {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.problems.length, 3);
    }
  });

  it('refuses to start in production without a JWT secret', () => {
    // Signing tokens with the checked-in development default would let anyone
    // mint a valid session, so this combination must never boot.
    assert.throws(() => loadConfig({ NODE_ENV: 'production' }), ConfigError);
  });

  it('rejects a production JWT secret that is too short to be useful', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' }), ConfigError);
  });

  it('allows the development fallback secret outside production', () => {
    const config = loadConfig({ NODE_ENV: 'development' });
    assert.ok(config.auth.jwtSecret.length > 0);
  });

  it('rejects a simulated delay range that is inverted', () => {
    assert.throws(
      () => loadConfig({ SIMULATED_DELAY_MIN_MS: '500', SIMULATED_DELAY_MAX_MS: '100' }),
      ConfigError,
    );
  });

  it('rejects a payment failure rate outside 0 to 1', () => {
    assert.throws(() => loadConfig({ PAYMENT_FAILURE_RATE: '1.5' }), ConfigError);
  });

  it('parses boolean switches from the usual spellings', () => {
    assert.equal(loadConfig({ DB_AUTO_MIGRATE: 'true' }).database.autoMigrate, true);
    assert.equal(loadConfig({ DB_AUTO_MIGRATE: 'no' }).database.autoMigrate, false);
    assert.throws(() => loadConfig({ DB_AUTO_MIGRATE: 'maybe' }), ConfigError);
  });

  it('freezes the result so nothing mutates config at runtime', () => {
    const config = loadConfig({});
    assert.throws(() => {
      config.port = 1234;
    }, TypeError);
  });
});
