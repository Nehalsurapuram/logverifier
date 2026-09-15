import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../logger/index.js';
import { wrapDatabaseError } from './errors.js';

// node-postgres hands back BIGINT and NUMERIC as strings to avoid precision
// loss. COUNT(*) is the one place that bites constantly, so parse int8 here and
// keep money in integer cents everywhere else.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));

let pool;

/**
 * Lifetime counters. `acquired - released` is how many connections are checked
 * out right now; a `waiting` count that stays above zero is pool exhaustion.
 */
const counters = { opened: 0, acquired: 0, released: 0, removed: 0, errors: 0 };

/**
 * The pool is created lazily so importing this module never opens a socket —
 * tests and config-only code paths can load the app without a database.
 */
export function getPool() {
  if (pool) return pool;

  pool = new pg.Pool({
    connectionString: config.database.url,

    // Pool sizing. `max` is the knob that makes exhaustion reproducible: set it
    // to 1 or 2 and concurrent requests immediately start queueing.
    max: config.database.poolMax,
    min: config.database.poolMin,

    // How long a request waits for a free connection before giving up. Without
    // this a saturated pool makes requests hang forever instead of failing
    // fast with something a caller can act on.
    connectionTimeoutMillis: config.database.connectionTimeoutMs,
    idleTimeoutMillis: config.database.idleTimeoutMs,

    // Server-side ceiling: PostgreSQL itself cancels the query. This is what
    // stops one pathological statement from pinning a connection forever.
    statement_timeout: config.database.statementTimeoutMs,
    // Client-side ceiling, in case the server never answers at all.
    query_timeout: config.database.queryTimeoutMs,

    // Shows up in pg_stat_activity, so a DBA looking at a busy server can tell
    // which service the connections belong to.
    application_name: config.database.applicationName,
  });

  pool.on('connect', () => {
    counters.opened += 1;
  });
  pool.on('acquire', () => {
    counters.acquired += 1;
  });
  pool.on('release', () => {
    counters.released += 1;
  });
  pool.on('remove', () => {
    counters.removed += 1;
  });

  // An idle client dropped by the server must not take the process down with
  // an unhandled 'error' event.
  pool.on('error', (err) => {
    counters.errors += 1;
    logger.error('idle database client error', wrapDatabaseError(err).toLogContext());
  });

  logger.debug('database pool created', {
    max: config.database.poolMax,
    min: config.database.poolMin,
    connectionTimeoutMs: config.database.connectionTimeoutMs,
    statementTimeoutMs: config.database.statementTimeoutMs,
  });

  return pool;
}

/**
 * A snapshot of pool saturation. Safe to return from /health: it describes
 * capacity, never credentials or the connection string.
 */
export function getPoolStats() {
  const limits = {
    max: config.database.poolMax,
    min: config.database.poolMin,
    connectionTimeoutMs: config.database.connectionTimeoutMs,
  };

  if (!pool) {
    return {
      ...limits,
      initialised: false,
      total: 0,
      idle: 0,
      inUse: 0,
      waiting: 0,
      saturated: false,
      utilisationPercent: 0,
      counters: { ...counters },
    };
  }

  const total = pool.totalCount;
  const idle = pool.idleCount;
  const waiting = pool.waitingCount;

  return {
    ...limits,
    initialised: true,
    // Connections currently open to PostgreSQL.
    total,
    idle,
    inUse: total - idle,
    // Requests queued for a connection. Anything sustained above zero means
    // the pool is the bottleneck, not the database.
    waiting,
    saturated: waiting > 0,
    utilisationPercent: limits.max === 0 ? 0 : Math.round(((total - idle) / limits.max) * 100),
    counters: { ...counters },
  };
}

export async function closePool() {
  if (!pool) return;
  await pool.end();
  pool = undefined;
}

/** Test seam: lets a suite build a pool with different limits. */
export function isPoolInitialised() {
  return pool !== undefined;
}
