import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(currentDir, '../..');
const projectRoot = path.resolve(backendRoot, '..');

/**
 * A single .env at the project root configures both `docker compose` and a
 * local `npm start`. Inside a container compose injects the environment
 * directly and no .env file exists, so a missing file is not an error.
 */
const envFile = [path.join(projectRoot, '.env'), path.join(backendRoot, '.env')].find((candidate) =>
  existsSync(candidate),
);

if (envFile) {
  dotenv.config({ path: envFile, quiet: true });
}

const pkg = JSON.parse(readFileSync(path.join(backendRoot, 'package.json'), 'utf8'));

/** Used when no JWT_SECRET is set outside production. Never reachable in prod. */
const INSECURE_DEV_JWT_SECRET = 'dev-only-insecure-secret-do-not-use-in-production';

export class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/**
 * Reads and validates the environment. Every key has a default so a fresh
 * clone boots without a .env, and every problem is collected before throwing —
 * one run tells you everything that is wrong, not just the first thing.
 */
export function loadConfig(source = process.env) {
  const problems = [];

  const str = (key, fallback) => {
    const raw = source[key];
    if (raw === undefined || raw === '') return fallback;
    return raw;
  };

  const int = (key, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const raw = source[key];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${key} must be an integer between ${min} and ${max} (received "${raw}")`);
      return fallback;
    }
    return value;
  };

  const num = (key, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const raw = source[key];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      problems.push(`${key} must be a number between ${min} and ${max} (received "${raw}")`);
      return fallback;
    }
    return value;
  };

  const bool = (key, fallback) => {
    const raw = source[key];
    if (raw === undefined || raw === '') return fallback;
    if (['true', '1', 'yes'].includes(raw.toLowerCase())) return true;
    if (['false', '0', 'no'].includes(raw.toLowerCase())) return false;
    problems.push(`${key} must be true or false (received "${raw}")`);
    return fallback;
  };

  const oneOf = (key, allowed, fallback) => {
    const raw = source[key];
    if (raw === undefined || raw === '') return fallback;
    if (!allowed.includes(raw)) {
      problems.push(`${key} must be one of ${allowed.join(' | ')} (received "${raw}")`);
      return fallback;
    }
    return raw;
  };

  const env = oneOf('NODE_ENV', ['development', 'test', 'production'], 'development');
  const isProduction = env === 'production';

  const database = {
    host: str('POSTGRES_HOST', 'localhost'),
    port: int('POSTGRES_PORT', 5432, { max: 65535 }),
    user: str('POSTGRES_USER', 'observability'),
    password: str('POSTGRES_PASSWORD', 'observability'),
    name: str('POSTGRES_DB', 'observability'),
    // Pool sizing. Lower `max` to make pool exhaustion reproducible on demand:
    // with max=1 any two concurrent requests immediately queue behind it.
    poolMax: int('DB_POOL_MAX', 10, { max: 100 }),
    poolMin: int('DB_POOL_MIN', 0, { min: 0, max: 100 }),
    // How long a request waits for a free connection before failing fast. A
    // saturated pool should produce a 503, not a request that hangs forever.
    connectionTimeoutMs: int('DB_CONNECTION_TIMEOUT_MS', 5000),
    idleTimeoutMs: int('DB_IDLE_TIMEOUT_MS', 30000),
    // Server-side and client-side query ceilings, so one pathological
    // statement cannot pin a pooled connection indefinitely.
    statementTimeoutMs: int('DB_STATEMENT_TIMEOUT_MS', 15000),
    queryTimeoutMs: int('DB_QUERY_TIMEOUT_MS', 15000),
    // Statements at or above this duration are logged as slow.
    slowQueryMs: int('DB_SLOW_QUERY_MS', 500),
    // How often the background probe refreshes the cached health reading
    // that /health serves.
    healthIntervalMs: int('DB_HEALTH_INTERVAL_MS', 10000),
    // Convenient for a demo stack; a real deployment runs migrations as a
    // separate step so two starting replicas cannot race each other.
    autoMigrate: bool('DB_AUTO_MIGRATE', false),
  };

  // Identifies this service's connections in pg_stat_activity.
  database.applicationName = str('DB_APP_NAME', str('SERVICE_NAME', 'observability-backend'));

  if (database.poolMin > database.poolMax) {
    problems.push(
      `DB_POOL_MIN (${database.poolMin}) must not exceed DB_POOL_MAX (${database.poolMax})`,
    );
  }

  // An explicit DATABASE_URL wins, so a managed database can be pointed at
  // without unpicking it into parts.
  database.url =
    str('DATABASE_URL', undefined) ??
    `postgresql://${encodeURIComponent(database.user)}:${encodeURIComponent(database.password)}` +
      `@${database.host}:${database.port}/${database.name}`;

  const auth = {
    jwtSecret: str('JWT_SECRET', undefined),
    jwtExpiresIn: str('JWT_EXPIRES_IN', '1h'),
  };

  // A production deployment signing tokens with a checked-in default would let
  // anyone mint a valid session, so that combination is refused outright.
  if (!auth.jwtSecret) {
    if (isProduction) problems.push('JWT_SECRET is required when NODE_ENV=production');
    auth.jwtSecret = INSECURE_DEV_JWT_SECRET;
  } else if (isProduction && auth.jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters when NODE_ENV=production');
  }

  const simulation = {
    // Requirement: artificial latency exists ONLY through this switch. No
    // sleep is hard-coded anywhere in the request path.
    delayEnabled: bool('SIMULATED_DELAY_ENABLED', false),
    delayMinMs: int('SIMULATED_DELAY_MIN_MS', 0, { min: 0 }),
    delayMaxMs: int('SIMULATED_DELAY_MAX_MS', 0, { min: 0 }),
    // Share of payment attempts the mock provider fails at random, 0 to 1.
    paymentFailureRate: num('PAYMENT_FAILURE_RATE', 0, { min: 0, max: 1 }),
  };

  if (simulation.delayMinMs > simulation.delayMaxMs) {
    problems.push(
      `SIMULATED_DELAY_MIN_MS (${simulation.delayMinMs}) must not exceed ` +
        `SIMULATED_DELAY_MAX_MS (${simulation.delayMaxMs})`,
    );
  }

  const commerce = {
    taxRatePercent: num('TAX_RATE_PERCENT', 8.5, { min: 0, max: 100 }),
    maxOrderItems: int('MAX_ORDER_ITEMS', 20, { max: 100 }),
  };

  const config = {
    env,
    isProduction,
    serviceName: str('SERVICE_NAME', 'observability-backend'),
    version: pkg.version,
    host: str('HOST', '0.0.0.0'),
    port: int('PORT', 4000, { max: 65535 }),
    logLevel: oneOf('LOG_LEVEL', ['debug', 'info', 'warn', 'error'], 'info'),
    // How long in-flight requests get to finish after SIGTERM/SIGINT.
    shutdownTimeoutMs: int('SHUTDOWN_TIMEOUT_MS', 10000),
    database,
    auth,
    simulation,
    commerce,
  };

  if (problems.length > 0) throw new ConfigError(problems);

  return Object.freeze(config);
}

export const config = loadConfig();

/** True when the signing key is the built-in development fallback. */
export function isUsingInsecureJwtSecret() {
  return config.auth.jwtSecret === INSECURE_DEV_JWT_SECRET;
}
