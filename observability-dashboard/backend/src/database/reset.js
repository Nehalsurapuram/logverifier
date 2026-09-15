import { pathToFileURL } from 'node:url';
import { config } from '../config/index.js';
import { logger } from '../logger/index.js';
import { closePool, getPool } from './pool.js';
import { runMigrations } from './migrate.js';

/**
 * Drops every table this service owns and rebuilds them from the migrations.
 *
 * Destructive by definition, so it refuses to run against production unless
 * explicitly forced. The guard is deliberately annoying: the one time it fires
 * is the time it matters.
 */
export async function resetDatabase({ force = false } = {}) {
  if (config.isProduction && !force) {
    throw new Error(
      'Refusing to reset the database with NODE_ENV=production. ' +
        'Re-run with DB_RESET_FORCE=true if that is genuinely what you want.',
    );
  }

  const pool = getPool();

  // CASCADE clears the foreign keys between them, so the order of this list
  // does not have to be maintained as the schema grows. schema_migrations goes
  // too, otherwise the rebuild would think everything was already applied.
  await pool.query(`
    DROP TABLE IF EXISTS
      payments, order_items, orders, products, users, schema_migrations
    CASCADE
  `);
  await pool.query('DROP FUNCTION IF EXISTS set_updated_at() CASCADE');

  logger.warn('database dropped', { database: config.database.name });

  const { applied } = await runMigrations();
  logger.info('database rebuilt', { migrations: applied.length });

  return { applied };
}

// Also usable directly: `npm run db:reset`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await resetDatabase({ force: process.env.DB_RESET_FORCE === 'true' });
    await closePool();
    process.exit(0);
  } catch (err) {
    logger.error('database reset failed', { err });
    await closePool().catch(() => {});
    process.exit(1);
  }
}
