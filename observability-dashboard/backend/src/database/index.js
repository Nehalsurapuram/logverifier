import { config } from '../config/index.js';
import { logger } from '../logger/index.js';
import { summariseStatement, wrapDatabaseError } from './errors.js';
import { getPool } from './pool.js';
import { recordDatabaseError, recordDatabaseQuery } from '../metrics/index.js';

/**
 * Public database API.
 *
 * Every value that reaches PostgreSQL does so as a bound parameter. Nothing in
 * this codebase interpolates input into SQL — the only interpolated fragment
 * anywhere is a sort direction chosen from a fixed map keyed by a validated
 * enum. That is what makes the statement text itself safe to log while the
 * parameters never are.
 */

export { getPool, getPoolStats, closePool, isPoolInitialised } from './pool.js';
export {
  checkDatabaseHealth,
  getCachedDatabaseHealth,
  probeDatabase,
  startDatabaseHealthMonitor,
  stopDatabaseHealthMonitor,
} from './health.js';
export {
  DatabaseError,
  PG_ERRORS,
  classifyDatabaseError,
  isConnectionError,
  isUniqueViolation,
  redactSecrets,
  summariseStatement,
  wrapDatabaseError,
} from './errors.js';

export async function query(text, params) {
  return runStatement(getPool(), text, params);
}

/**
 * Runs `fn` inside a transaction on a single dedicated client, committing on
 * success and rolling back on any throw.
 *
 * Order creation and payment capture both read, check and write in one
 * indivisible step — doing that across pooled connections would let two
 * concurrent requests interleave and oversell stock.
 *
 * The client handed to `fn` wraps errors the same way `query` does, so a
 * failure inside a transaction is exactly as safe to log as one outside it.
 */
export async function withTransaction(fn) {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await fn({
      query: (text, params) => runStatement(client, text, params),
      // An escape hatch for anything needing the driver client directly.
      raw: client,
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // The original error is the useful one; surface the rollback failure
      // separately rather than letting it mask the cause.
      logger.error('rollback failed', wrapDatabaseError(rollbackError).toLogContext());
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * One place where every statement is timed, slow ones are reported, and
 * failures are stripped of anything a user typed.
 */
/** Bounded label set — a free-form operation label would be a cardinality leak. */
const KNOWN_OPERATIONS = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE',
  'BEGIN', 'COMMIT', 'ROLLBACK',
  'CREATE', 'DROP', 'ALTER', 'EXPLAIN',
]);

function operationOf(sql) {
  const first = String(sql).trim().split(/\s+/, 1)[0]?.toUpperCase();
  return KNOWN_OPERATIONS.has(first) ? first : 'OTHER';
}

async function runStatement(executor, text, params) {
  const startedAt = performance.now();
  const operation = operationOf(text);

  try {
    const result = await executor.query(text, params);
    const durationMs = Math.round(performance.now() - startedAt);

    recordDatabaseQuery({ operation, outcome: 'success', durationMs });

    if (durationMs >= config.database.slowQueryMs) {
      // The statement, never the parameters: a WHERE email = $1 is safe to
      // print, the address bound to $1 is not.
      logger.warn('slow query', {
        durationMs,
        rowCount: result.rowCount,
        statement: summariseStatement(text),
      });
    }

    return result;
  } catch (err) {
    const wrapped = wrapDatabaseError(err, text);
    const durationMs = Math.round(performance.now() - startedAt);

    recordDatabaseQuery({ operation, outcome: 'failure', durationMs });
    recordDatabaseError({ kind: wrapped.kind, sqlstate: wrapped.code });

    logger.error('query failed', { ...wrapped.toLogContext(), durationMs });
    throw wrapped;
  }
}
