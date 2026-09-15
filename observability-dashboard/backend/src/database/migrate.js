import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { closePool, getPool } from './index.js';
import { logger } from '../logger/index.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Applies every unapplied `.sql` file in `migrations/`, in filename order.
 *
 * Each migration runs inside its own transaction together with the row that
 * records it, so a failure leaves the database exactly as it was — never half
 * migrated with the bookkeeping out of step.
 */
export async function runMigrations() {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query('SELECT id FROM schema_migrations');
  const alreadyApplied = new Set(rows.map((row) => row.id));
  const pending = files.filter((file) => !alreadyApplied.has(file));

  if (pending.length === 0) {
    logger.info('database schema up to date', { migrations: files.length });
    return { applied: [] };
  }

  for (const file of pending) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    const startedAt = performance.now();

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info('migration applied', {
        migration: file,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
    } finally {
      client.release();
    }
  }

  return { applied: pending };
}

// Also usable directly: `npm run db:migrate`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { applied } = await runMigrations();
    logger.info('migrations complete', { applied: applied.length });
    await closePool();
    process.exit(0);
  } catch (err) {
    logger.error('migrations failed', { err });
    await closePool().catch(() => {});
    process.exit(1);
  }
}
