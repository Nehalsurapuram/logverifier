import { config } from '../config/index.js';
import { wrapDatabaseError } from './errors.js';
import { getPool, getPoolStats } from './pool.js';

/**
 * Database health, in two flavours.
 *
 * `/health` is a liveness probe: it must answer instantly and must never fail
 * because a dependency is down, or an outage would make an orchestrator kill a
 * perfectly healthy container. So it reads the *cached* result below.
 *
 * `/health/ready` is a readiness probe and is allowed to be slow and
 * authoritative, so it runs a live query.
 */
let lastResult = { status: 'unknown', checkedAt: null, latencyMs: null, error: null };
let timer;

/** Runs a real query. Never throws: a down database is a state, not an error. */
export async function probeDatabase() {
  const startedAt = performance.now();

  try {
    await getPool().query('SELECT 1');
    lastResult = {
      status: 'up',
      latencyMs: Math.round(performance.now() - startedAt),
      checkedAt: new Date().toISOString(),
      error: null,
    };
  } catch (err) {
    const safe = wrapDatabaseError(err);
    lastResult = {
      status: 'down',
      latencyMs: Math.round(performance.now() - startedAt),
      checkedAt: new Date().toISOString(),
      // The wrapped message is already redacted, so a connection string in a
      // driver error cannot reach the response body.
      error: safe.message,
    };
  }

  return lastResult;
}

/** The authoritative check, used by readiness. */
export async function checkDatabaseHealth() {
  const result = await probeDatabase();
  return { ...result, pool: getPoolStats() };
}

/**
 * The cached view, used by liveness. Costs nothing and cannot block, so
 * /health stays instant whatever the database is doing.
 */
export function getCachedDatabaseHealth() {
  return { ...lastResult, pool: getPoolStats() };
}

/**
 * Refreshes the cache in the background so /health reports something recent
 * without ever doing I/O itself.
 */
export function startDatabaseHealthMonitor() {
  if (timer) return;

  void probeDatabase();
  timer = setInterval(() => void probeDatabase(), config.database.healthIntervalMs);
  // Must not keep the process alive during shutdown.
  timer.unref();
}

export function stopDatabaseHealthMonitor() {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}
