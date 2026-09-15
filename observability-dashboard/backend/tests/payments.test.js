import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closePool } from '../src/database/index.js';
import {
  apiClient,
  cleanup,
  createTestProduct,
  databaseSkipReason,
  getOrderStatus,
  registerUser,
  startTestServer,
} from './helpers.js';

const skip = await databaseSkipReason();

// Published sandbox numbers, all Luhn-valid so they reach the provider.
const CARDS = {
  success: '4242424242424242',
  declined: '4000000000000002',
  insufficientFunds: '4000000000009995',
  providerError: '4000000000000119',
};

function card(number) {
  return {
    number,
    expiryMonth: 12,
    expiryYear: new Date().getUTCFullYear() + 2,
    cvc: '123',
    holderName: 'Test Person',
  };
}

describe('payments', { skip }, () => {
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

    product = await createTestProduct({ priceCents: 1999, stock: 500 });
    createdProductIds.push(product.id);
  });

  after(async () => {
    await cleanup({ userIds: createdUserIds, productIds: createdProductIds });
    await new Promise((resolve) => server.close(resolve));
    await closePool();
  });

  async function createOrder(quantity = 1) {
    const res = await request('POST', '/api/orders', {
      token,
      body: { items: [{ productId: product.id, quantity }] },
    });
    assert.equal(res.status, 201);
    return res.body.data;
  }

  it('pays an order and marks it paid', async () => {
    const order = await createOrder();

    const res = await request('POST', '/api/payments', {
      token,
      body: { orderId: order.id, card: card(CARDS.success) },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.payment.status, 'succeeded');
    assert.equal(res.body.data.order.status, 'paid');
    assert.equal(res.body.data.payment.amount.amountCents, order.totals.total.amountCents);
    assert.equal(await getOrderStatus(order.id), 'paid');
  });

  it('stores only the brand and last four digits of the card', async () => {
    const order = await createOrder();

    const res = await request('POST', '/api/payments', {
      token,
      body: { orderId: order.id, card: card(CARDS.success) },
    });

    assert.equal(res.body.data.payment.card.last4, '4242');
    assert.equal(res.body.data.payment.card.brand, 'visa');
    // The full number must appear nowhere in the response.
    assert.equal(res.text.includes(CARDS.success), false);
  });

  it('returns 402 for a declined card and records the attempt', async () => {
    const order = await createOrder();

    const res = await request('POST', '/api/payments', {
      token,
      body: { orderId: order.id, card: card(CARDS.declined) },
    });

    assert.equal(res.status, 402);
    assert.equal(res.body.error.code, 'PAYMENT_DECLINED');
    assert.equal(res.body.error.details.failureCode, 'card_declined');
    // The failure was committed, not rolled back with the error.
    assert.ok(res.body.error.details.paymentId);
    assert.equal(await getOrderStatus(order.id), 'payment_failed');
  });

  it('distinguishes insufficient funds from a generic decline', async () => {
    const order = await createOrder();

    const res = await request('POST', '/api/payments', {
      token,
      body: { orderId: order.id, card: card(CARDS.insufficientFunds) },
    });

    assert.equal(res.status, 402);
    assert.equal(res.body.error.details.failureCode, 'insufficient_funds');
  });

  it('returns 502 when the provider itself fails', async () => {
    const order = await createOrder();

    const res = await request('POST', '/api/payments', {
      token,
      body: { orderId: order.id, card: card(CARDS.providerError) },
    });

    // 502, not 402: the card was never judged, so retrying it may well work.
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'PAYMENT_PROVIDER_ERROR');
  });

  it('allows a retry after a failed payment', async () => {
    const order = await createOrder();

    await request('POST', '/api/payments', {
      token,
      body: { orderId: order.id, card: card(CARDS.declined) },
    });
    const retry = await request('POST', '/api/payments', {
      token,
      body: { orderId: order.id, card: card(CARDS.success) },
    });

    assert.equal(retry.status, 201);
    assert.equal(await getOrderStatus(order.id), 'paid');
  });

  it('refuses to charge the same order twice', async () => {
    const order = await createOrder();

    await request('POST', '/api/payments', {
      token,
      body: { orderId: order.id, card: card(CARDS.success) },
    });
    const second = await request('POST', '/api/payments', {
      token,
      body: { orderId: order.id, card: card(CARDS.success) },
    });

    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'ORDER_ALREADY_PAID');
  });

  it('rejects a card number that fails the Luhn checksum', async () => {
    const order = await createOrder();

    const res = await request('POST', '/api/payments', {
      token,
      body: { orderId: order.id, card: card('4242424242424241') },
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('rejects an expired card', async () => {
    const order = await createOrder();

    const res = await request('POST', '/api/payments', {
      token,
      body: {
        orderId: order.id,
        card: { ...card(CARDS.success), expiryMonth: 1, expiryYear: 2020 },
      },
    });

    assert.equal(res.status, 400);
  });

  it('will not let one user pay another users order', async () => {
    const order = await createOrder();
    const other = await registerUser(request);
    createdUserIds.push(other.user.id);

    const res = await request('POST', '/api/payments', {
      token: other.token,
      body: { orderId: order.id, card: card(CARDS.success) },
    });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'ORDER_NOT_FOUND');
  });

  it('requires authentication', async () => {
    const res = await request('POST', '/api/payments', {
      body: { orderId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', card: card(CARDS.success) },
    });

    assert.equal(res.status, 401);
  });
});
