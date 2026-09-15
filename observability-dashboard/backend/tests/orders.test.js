import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closePool } from '../src/database/index.js';
import {
  apiClient,
  cleanup,
  createTestProduct,
  databaseSkipReason,
  getProductStock,
  registerUser,
  startTestServer,
} from './helpers.js';

const skip = await databaseSkipReason();

describe('orders', { skip }, () => {
  let server;
  let baseUrl;
  let token;
  let product;
  const request = apiClient(() => baseUrl);
  const createdUserIds = [];
  const createdProductIds = [];

  before(async () => {
    ({ server, baseUrl } = await startTestServer());

    const account = await registerUser(request);
    token = account.token;
    createdUserIds.push(account.user.id);

    product = await createTestProduct({ priceCents: 2500, stock: 100 });
    createdProductIds.push(product.id);
  });

  after(async () => {
    await cleanup({ userIds: createdUserIds, productIds: createdProductIds });
    await new Promise((resolve) => server.close(resolve));
    await closePool();
  });

  describe('POST /api/orders', () => {
    it('creates an order and computes subtotal, tax and total from integer cents', async () => {
      const res = await request('POST', '/api/orders', {
        token,
        body: { items: [{ productId: product.id, quantity: 2 }] },
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.status, 'pending_payment');
      assert.equal(res.body.data.items.length, 1);

      const { subtotal, tax, total } = res.body.data.totals;
      assert.equal(subtotal.amountCents, 5000);
      // Totals must add up exactly; that is the whole point of integer cents.
      assert.equal(total.amountCents, subtotal.amountCents + tax.amountCents);
    });

    it('decrements stock by the quantity ordered', async () => {
      const before = await getProductStock(product.id);

      await request('POST', '/api/orders', {
        token,
        body: { items: [{ productId: product.id, quantity: 3 }] },
      });

      assert.equal(await getProductStock(product.id), before - 3);
    });

    it('captures the price at purchase time on each line item', async () => {
      const res = await request('POST', '/api/orders', {
        token,
        body: { items: [{ productId: product.id, quantity: 1 }] },
      });

      assert.equal(res.body.data.items[0].unitPrice.amountCents, product.price_cents);
      assert.equal(res.body.data.items[0].lineTotal.amountCents, product.price_cents);
    });

    it('refuses to oversell and reports what is actually available', async () => {
      const scarce = await createTestProduct({ priceCents: 1000, stock: 2 });
      createdProductIds.push(scarce.id);

      const res = await request('POST', '/api/orders', {
        token,
        body: { items: [{ productId: scarce.id, quantity: 5 }] },
      });

      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'INSUFFICIENT_STOCK');
      assert.equal(res.body.error.details.items[0].available, 2);
      assert.equal(res.body.error.details.items[0].requested, 5);

      // The whole transaction rolled back, so the stock is untouched.
      assert.equal(await getProductStock(scarce.id), 2);
    });

    it('rejects an order referencing a product that does not exist', async () => {
      const res = await request('POST', '/api/orders', {
        token,
        body: { items: [{ productId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', quantity: 1 }] },
      });

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'PRODUCT_NOT_FOUND');
    });

    it('rejects the same product listed twice', async () => {
      const res = await request('POST', '/api/orders', {
        token,
        body: {
          items: [
            { productId: product.id, quantity: 1 },
            { productId: product.id, quantity: 2 },
          ],
        },
      });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('rejects an empty order', async () => {
      const res = await request('POST', '/api/orders', { token, body: { items: [] } });
      assert.equal(res.status, 400);
    });

    it('requires authentication', async () => {
      const res = await request('POST', '/api/orders', {
        body: { items: [{ productId: product.id, quantity: 1 }] },
      });

      assert.equal(res.status, 401);
    });
  });

  describe('GET /api/orders', () => {
    it('lists only the callers own orders', async () => {
      const other = await registerUser(request);
      createdUserIds.push(other.user.id);

      await request('POST', '/api/orders', {
        token: other.token,
        body: { items: [{ productId: product.id, quantity: 1 }] },
      });

      const mine = await request('GET', '/api/orders', { token });
      const theirs = await request('GET', '/api/orders', { token: other.token });

      assert.equal(mine.status, 200);
      assert.equal(theirs.body.data.items.length, 1);
      assert.ok(mine.body.data.pagination.total > theirs.body.data.pagination.total);
    });
  });

  describe('GET /api/orders/:id', () => {
    it('returns the order with its line items', async () => {
      const created = await request('POST', '/api/orders', {
        token,
        body: { items: [{ productId: product.id, quantity: 1 }] },
      });

      const res = await request('GET', `/api/orders/${created.body.data.id}`, { token });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.id, created.body.data.id);
      assert.equal(res.body.data.items[0].quantity, 1);
      assert.equal(res.body.data.payment, null);
    });

    it('hides another users order behind a 404 rather than a 403', async () => {
      const created = await request('POST', '/api/orders', {
        token,
        body: { items: [{ productId: product.id, quantity: 1 }] },
      });

      const other = await registerUser(request);
      createdUserIds.push(other.user.id);

      const res = await request('GET', `/api/orders/${created.body.data.id}`, {
        token: other.token,
      });

      // A 403 would confirm the id exists, which is itself a leak.
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'ORDER_NOT_FOUND');
    });
  });
});
