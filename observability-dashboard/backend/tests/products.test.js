import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closePool } from '../src/database/index.js';
import { apiClient, databaseSkipReason, startTestServer } from './helpers.js';

const skip = await databaseSkipReason();

describe('products', { skip }, () => {
  let server;
  let baseUrl;
  const request = apiClient(() => baseUrl);

  before(async () => {
    ({ server, baseUrl } = await startTestServer());
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closePool();
  });

  describe('GET /api/products', () => {
    it('returns the seeded catalogue with pagination metadata', async () => {
      const res = await request('GET', '/api/products');

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.data.items));
      assert.ok(res.body.data.items.length > 0);

      const { pagination } = res.body.data;
      assert.equal(pagination.page, 1);
      assert.equal(pagination.limit, 20);
      assert.ok(pagination.total >= res.body.data.items.length);
    });

    it('exposes prices as integer cents plus a formatted string', async () => {
      const res = await request('GET', '/api/products?limit=1');
      const [product] = res.body.data.items;

      assert.ok(Number.isInteger(product.price.amountCents));
      assert.equal(product.price.currency, 'USD');
      assert.match(product.price.formatted, /^\d+\.\d{2} USD$/);
    });

    it('pages without repeating a row across pages', async () => {
      const first = await request('GET', '/api/products?limit=3&page=1&sort=name_asc');
      const second = await request('GET', '/api/products?limit=3&page=2&sort=name_asc');

      const firstIds = first.body.data.items.map((p) => p.id);
      const secondIds = second.body.data.items.map((p) => p.id);

      assert.equal(firstIds.length, 3);
      assert.equal(secondIds.some((id) => firstIds.includes(id)), false);
    });

    it('filters by category', async () => {
      const res = await request('GET', '/api/products?category=audio');

      assert.equal(res.status, 200);
      assert.ok(res.body.data.items.length > 0);
      assert.ok(res.body.data.items.every((p) => p.category === 'audio'));
    });

    it('searches by name', async () => {
      const res = await request('GET', '/api/products?search=keyboard');

      assert.equal(res.status, 200);
      assert.ok(res.body.data.items.every((p) => /keyboard/i.test(p.name)));
    });

    it('sorts by price ascending', async () => {
      const res = await request('GET', '/api/products?sort=price_asc&limit=50');
      const prices = res.body.data.items.map((p) => p.price.amountCents);

      assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
    });

    it('reports an out-of-stock product as unavailable rather than hiding it', async () => {
      const res = await request('GET', '/api/products?search=webcam');
      const webcam = res.body.data.items[0];

      assert.equal(webcam.stock, 0);
      assert.equal(webcam.inStock, false);
    });

    it('rejects an impossible price range', async () => {
      const res = await request('GET', '/api/products?minPrice=9000&maxPrice=100');

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('rejects an unknown sort key instead of silently ignoring it', async () => {
      const res = await request('GET', '/api/products?sort=cheapest');
      assert.equal(res.status, 400);
    });
  });

  describe('GET /api/products/:id', () => {
    it('returns one product with related items from the same category', async () => {
      const list = await request('GET', '/api/products?category=audio');
      const target = list.body.data.items[0];

      const res = await request('GET', `/api/products/${target.id}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.id, target.id);
      assert.ok(Array.isArray(res.body.data.related));
      assert.equal(res.body.data.related.some((p) => p.id === target.id), false);
      assert.ok(res.body.data.related.every((p) => p.category === 'audio'));
    });

    it('returns 404 for a well-formed id that does not exist', async () => {
      const res = await request('GET', '/api/products/3f2504e0-4f89-41d3-9a0c-0305e82c3301');

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'PRODUCT_NOT_FOUND');
    });

    it('returns 400 for an id that is not a uuid', async () => {
      const res = await request('GET', '/api/products/not-a-uuid');

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });
  });
});
