import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { checkDatabaseHealth, query } from '../src/database/index.js';
import { runMigrations } from '../src/database/migrate.js';

/** Not named *.test.js, so the runner treats this as a helper, not a suite. */

export async function startTestServer() {
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');

  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Database-backed suites skip rather than fail when PostgreSQL is absent, so
 * `npm test` still says something useful on a machine with no containers
 * running. The message names the command that fixes it.
 */
export async function databaseSkipReason() {
  const health = await checkDatabaseHealth();
  if (health.status === 'up') {
    // Idempotent, and it makes the suite self-sufficient on a fresh volume.
    await runMigrations();
    return false;
  }
  return `PostgreSQL is not reachable (${health.error}). Start it with: docker compose up -d postgres`;
}

/** Minimal typed-ish HTTP client so each test reads as one line per call. */
export function apiClient(getBaseUrl) {
  return async function request(method, path, { body, token, headers } = {}) {
    const response = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    return { status: response.status, headers: response.headers, body: parsed, text };
  };
}

export function uniqueEmail() {
  return `test-${randomUUID()}@example.test`;
}

/** Registers a throwaway account and returns it along with a usable token. */
export async function registerUser(request, overrides = {}) {
  const payload = {
    email: uniqueEmail(),
    name: 'Test Person',
    password: 'correct-horse-battery-staple',
    ...overrides,
  };

  const response = await request('POST', '/api/auth/register', { body: payload });
  if (response.status !== 201) {
    throw new Error(`registerUser failed: ${response.status} ${response.text}`);
  }

  return { ...response.body.data, password: payload.password };
}

/**
 * Order and payment suites use their own products rather than the seeded
 * catalogue: buying decrements stock, and draining the demo data a little on
 * every test run would eventually make the suite fail for the wrong reason.
 */
export async function createTestProduct({ priceCents = 5000, stock = 50 } = {}) {
  const sku = `TEST-${randomUUID().slice(0, 8).toUpperCase()}`;

  const { rows } = await query(
    `INSERT INTO products (sku, name, description, category, price_cents, stock)
          VALUES ($1, $2, 'Created by the test suite.', 'test-fixtures', $3, $4)
       RETURNING id, sku, price_cents, stock`,
    [sku, `Test Product ${sku}`, priceCents, stock],
  );

  return rows[0];
}

export async function getProductStock(productId) {
  const { rows } = await query('SELECT stock FROM products WHERE id = $1', [productId]);
  return rows[0]?.stock ?? null;
}

export async function getOrderStatus(orderId) {
  const { rows } = await query('SELECT status FROM orders WHERE id = $1', [orderId]);
  return rows[0]?.status ?? null;
}

/**
 * Deleting the users cascades to their orders, order items and payments, which
 * has to happen before the fixture products can go — order_items references
 * products without ON DELETE CASCADE, deliberately, so purchase history cannot
 * be erased by deleting a product.
 */
export async function cleanup({ userIds = [], productIds = [] }) {
  if (userIds.length > 0) {
    await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  }
  if (productIds.length > 0) {
    await query('DELETE FROM products WHERE id = ANY($1::uuid[])', [productIds]);
  }
}
