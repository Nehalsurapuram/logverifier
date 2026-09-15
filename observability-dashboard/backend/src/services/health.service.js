import { config } from '../config/index.js';
import { checkDatabaseHealth, getCachedDatabaseHealth } from '../database/index.js';

const startedAt = Date.now();

/**
 * Liveness: is this process up?
 *
 * It reports the database, but reads a value the background monitor refreshed
 * rather than querying here. That distinction is the whole design: a liveness
 * probe that blocks on a dependency turns a database outage into a restart
 * loop, because the orchestrator times the probe out and kills a container
 * that was working perfectly.
 *
 * So `status` stays "ok" whatever the database is doing — this endpoint answers
 * "should you restart me", and the answer is no. Whether traffic should be sent
 * is `/health/ready`.
 */
export function getLiveness() {
  return {
    status: 'ok',
    service: config.serviceName,
    version: config.version,
    environment: config.env,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    dependencies: { database: describe(getCachedDatabaseHealth(), { cached: true }) },
  };
}

/**
 * Readiness: can it serve traffic? This one probes for real, so a load
 * balancer can pull the instance without restarting it.
 */
export async function getReadiness() {
  const database = describe(await checkDatabaseHealth(), { cached: false });
  const dependencies = { database };
  const ready = Object.values(dependencies).every((dep) => dep.status === 'up');

  return {
    status: ready ? 'ready' : 'not_ready',
    service: config.serviceName,
    dependencies,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Shapes a health reading for public consumption.
 *
 * Everything here describes capacity and latency. The connection string, the
 * host, the user and the password are all absent by construction — the only
 * free-text field is an already-redacted driver message.
 */
function describe(reading, { cached }) {
  return {
    status: reading.status,
    latencyMs: reading.latencyMs,
    checkedAt: reading.checkedAt,
    cached,
    pool: {
      max: reading.pool.max,
      min: reading.pool.min,
      total: reading.pool.total,
      idle: reading.pool.idle,
      inUse: reading.pool.inUse,
      // Sustained above zero means requests are queueing for a connection:
      // the pool is the bottleneck, not PostgreSQL.
      waiting: reading.pool.waiting,
      saturated: reading.pool.saturated,
      utilisationPercent: reading.pool.utilisationPercent,
    },
    ...(reading.error ? { error: reading.error } : {}),
  };
}
