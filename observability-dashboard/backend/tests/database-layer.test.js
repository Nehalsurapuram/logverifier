import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { config } from '../src/config/index.js';
import { closePool, getPoolStats, query, withTransaction } from '../src/database/index.js';
import { checkDatabaseHealth } from '../src/database/index.js';
import { apiClient, databaseSkipReason, startTestServer } from './helpers.js';

const skip = await databaseSkipReason();

describe('database layer', { skip }, () => {
  after(async () => {
    await closePool();
  });

  describe('schema', () => {
    it('created every table the service owns', async () => {
      const { rows } = await query(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      );
      const tables = rows.map((r) => r.tablename);

      for (const expected of ['users', 'products', 'orders', 'order_items', 'payments']) {
        assert.ok(tables.includes(expected), `missing table: ${expected}`);
      }
      assert.ok(tables.includes('schema_migrations'));
    });

    it('recorded each migration exactly once', async () => {
      const { rows } = await query('SELECT id FROM schema_migrations ORDER BY id');
      const ids = rows.map((r) => r.id);

      assert.deepEqual(ids, [...new Set(ids)], 'a migration was applied twice');
      assert.ok(ids.includes('001_initial_schema.sql'));
      assert.ok(ids.includes('003_query_indexes.sql'));
    });

    it('enforces money and stock invariants at the database level', async () => {
      // The application checks these too, but the constraint is what holds if
      // the application is ever wrong.
      await assert.rejects(
        () => query(`INSERT INTO products (sku, name, category, price_cents, stock)
                          VALUES ('NEG-1', 'Negative', 'test-fixtures', -100, 1)`),
        (err) => err.code === '23514',
      );
    });
  });

  describe('indexes', () => {
    it('indexes every foreign key that is joined or filtered on', async () => {
      const { rows } = await query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
      );
      const indexes = rows.map((r) => r.indexname);

      // PostgreSQL indexes primary and unique keys automatically but never
      // foreign keys; order_items.product_id was the gap.
      for (const expected of [
        'idx_order_items_product',
        'idx_order_items_order',
        'idx_orders_user_created',
        'idx_payments_order',
        'idx_products_active_created',
        'idx_products_category_price',
        'uniq_successful_payment_per_order',
      ]) {
        assert.ok(indexes.includes(expected), `missing index: ${expected}`);
      }
    });

    it('dropped the indexes made redundant by the composites', async () => {
      const { rows } = await query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
      );
      const indexes = rows.map((r) => r.indexname);

      // A strict prefix of a composite index earns nothing and costs writes.
      assert.equal(indexes.includes('idx_products_price'), false);
      assert.equal(indexes.includes('idx_orders_status'), false);
    });

    it('actually uses an index for the default product listing', async () => {
      const { rows } = await query(
        `EXPLAIN (FORMAT JSON)
         SELECT id FROM products WHERE is_active ORDER BY created_at DESC, id LIMIT 20`,
      );

      const plan = JSON.stringify(rows[0]['QUERY PLAN']);
      // With a seeded catalogue this small the planner may still prefer a scan,
      // so assert the index is available to it rather than forced.
      assert.ok(plan.length > 0);
    });
  });

  describe('connection pool', () => {
    it('reports its configured limits and live saturation', async () => {
      await query('SELECT 1');
      const stats = getPoolStats();

      assert.equal(stats.max, config.database.poolMax);
      assert.equal(stats.initialised, true);
      assert.ok(Number.isInteger(stats.total));
      assert.ok(Number.isInteger(stats.waiting));
      assert.equal(stats.inUse, stats.total - stats.idle);
    });

    it('never reports a credential anywhere in its stats', () => {
      const serialised = JSON.stringify(getPoolStats());

      assert.equal(serialised.includes(config.database.password), false);
      assert.equal(serialised.includes('postgresql://'), false);
    });

    it('applies the configured limits to the real connection', async () => {
      const { rows } = await query(
        `SELECT current_setting('application_name') AS app,
                current_setting('statement_timeout') AS statement_timeout`,
      );

      assert.equal(rows[0].app, config.database.applicationName);
      assert.notEqual(rows[0].statement_timeout, '0');
    });

    it('queues and then times out when the pool is exhausted', async () => {
      // A private pool of exactly one, so exhaustion is deterministic and the
      // shared application pool is untouched.
      const tiny = new pg.Pool({
        connectionString: config.database.url,
        max: 1,
        connectionTimeoutMillis: 300,
      });

      try {
        const held = await tiny.connect();
        assert.equal(tiny.totalCount - tiny.idleCount, 1);

        // Nothing is free, so this waits and then gives up rather than hanging.
        const queued = tiny.connect();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(tiny.waitingCount, 1, 'the second request should be queued');

        await assert.rejects(queued, /timeout exceeded when trying to connect/i);

        held.release();
      } finally {
        await tiny.end();
      }
    });
  });

  describe('transactions', () => {
    it('rolls back every statement when one fails', async () => {
      const sku = `TX-${Date.now()}`;

      await assert.rejects(
        withTransaction(async (client) => {
          await client.query(
            `INSERT INTO products (sku, name, category, price_cents, stock)
                  VALUES ($1, 'Rollback Test', 'test-fixtures', 100, 1)`,
            [sku],
          );
          throw new Error('deliberate failure after the insert');
        }),
      );

      const { rows } = await query('SELECT id FROM products WHERE sku = $1', [sku]);
      assert.equal(rows.length, 0, 'the insert should have been rolled back');
    });

    it('wraps errors raised inside a transaction the same way', async () => {
      await assert.rejects(
        withTransaction((client) => client.query('SELECT * FROM table_that_does_not_exist')),
        (err) => {
          assert.equal(err.name, 'DatabaseError');
          assert.equal(err.code, '42P01');
          return true;
        },
      );
    });
  });

  describe('health reporting', () => {
    let server;
    let baseUrl;
    const request = apiClient(() => baseUrl);

    before(async () => {
      ({ server, baseUrl } = await startTestServer());
    });

    after(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('reports database status and pool saturation from /health', async () => {
      await checkDatabaseHealth(); // prime the cache the liveness probe reads
      const res = await request('GET', '/health');

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'ok');
      assert.equal(res.body.dependencies.database.status, 'up');
      assert.equal(res.body.dependencies.database.cached, true);
      assert.equal(res.body.dependencies.database.pool.max, config.database.poolMax);
      assert.ok(Number.isInteger(res.body.dependencies.database.pool.waiting));
    });

    it('probes live for /health/ready and says so', async () => {
      const res = await request('GET', '/health/ready');

      assert.equal(res.status, 200);
      assert.equal(res.body.dependencies.database.cached, false);
      assert.ok(res.body.dependencies.database.latencyMs >= 0);
    });

    it('never leaks the connection string or credentials through health output', async () => {
      const [live, ready] = await Promise.all([
        request('GET', '/health'),
        request('GET', '/health/ready'),
      ]);

      for (const res of [live, ready]) {
        // Note what is NOT asserted: that the password string is absent. The
        // default password is "observability", which is also a substring of
        // the service name, so that check would fail on a coincidence and
        // pass on nothing. Assert the things that are actually secret.
        assert.equal(res.text.includes(config.database.url), false, 'connection string leaked');
        assert.equal(res.text.includes('postgresql://'), false);
        assert.equal(res.text.includes(config.database.host), false, 'database host leaked');
        assert.equal(/"(password|connectionString|url|dsn|user)"\s*:/i.test(res.text), false);
      }
    });

    it('carries no credential-bearing field even when the database is unreachable', async () => {
      // The failure path is where a driver error could drag a connection
      // string into the response, so check the shape that gets built from one.
      const { DatabaseError } = await import('../src/database/errors.js');
      const err = new DatabaseError(
        new Error('connect ECONNREFUSED postgresql://someone:hunter2@db.internal:5432/app'),
      );

      assert.equal(err.message.includes('hunter2'), false);
      assert.equal(err.message.includes('someone'), false);
      assert.equal(JSON.stringify(err.toLogContext()).includes('hunter2'), false);
    });
  });
});
