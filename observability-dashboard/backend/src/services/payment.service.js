import { PG_ERRORS, withTransaction } from '../database/index.js';
import { HttpError } from '../errors/http-error.js';
import { charge, detectBrand } from './mock-payment-provider.js';
import { recordPayment } from '../metrics/index.js';
import { money } from './money.js';

const RETRYABLE_ORDER_STATUSES = new Set(['pending_payment', 'payment_failed']);

/**
 * Attempts to pay an order and records the attempt either way.
 *
 * A decline is a business outcome, not an exception, so this resolves with the
 * recorded payment whatever happened and lets the controller pick the status
 * code. That ordering matters: throwing from inside the transaction would roll
 * back the very record that explains the failure.
 *
 * @returns {Promise<{payment: object, order: object}>}
 */
export async function payOrder(userId, { orderId, card }, log) {
  const cardBrand = detectBrand(card.number);
  const cardLast4 = card.number.slice(-4);

  return withTransaction(async (client) => {
    // Lock the order so two concurrent submissions cannot both see
    // 'pending_payment' and both charge the card.
    const {
      rows: [order],
    } = await client.query(
      `SELECT id, user_id, status, total_cents, currency
         FROM orders
        WHERE id = $1 AND user_id = $2
          FOR UPDATE`,
      [orderId, userId],
    );

    // Another user's order reports as missing rather than forbidden, so the
    // response cannot be used to discover which order ids exist.
    if (!order) {
      throw HttpError.notFound('Order not found', { code: 'ORDER_NOT_FOUND' });
    }

    if (order.status === 'paid') {
      throw new HttpError(409, 'This order has already been paid', {
        code: 'ORDER_ALREADY_PAID',
        expose: true,
        details: { orderId },
      });
    }

    if (!RETRYABLE_ORDER_STATUSES.has(order.status)) {
      throw new HttpError(409, `An order with status "${order.status}" cannot be paid`, {
        code: 'ORDER_NOT_PAYABLE',
        expose: true,
        details: { orderId, status: order.status },
      });
    }

    const currency = order.currency.trim();
    const authorisationStartedAt = performance.now();
    const result = await charge(
      { amountCents: order.total_cents, currency, card },
      log,
    );
    const authorisationMs = Math.round(performance.now() - authorisationStartedAt);

    const status = { succeeded: 'succeeded', declined: 'declined', error: 'failed' }[result.outcome];

    let payment;
    try {
      const inserted = await client.query(
        `INSERT INTO payments (order_id, status, amount_cents, currency, provider,
                               provider_reference, card_brand, card_last4,
                               failure_code, failure_message)
              VALUES ($1, $2, $3, $4, 'mock', $5, $6, $7, $8, $9)
           RETURNING id, order_id, status, amount_cents, currency, provider_reference,
                     card_brand, card_last4, failure_code, failure_message, created_at`,
        [
          order.id,
          status,
          order.total_cents,
          currency,
          result.reference ?? null,
          cardBrand,
          cardLast4,
          result.code ?? null,
          result.message ?? null,
        ],
      );
      payment = inserted.rows[0];
    } catch (err) {
      // The partial unique index on successful payments is the last line of
      // defence against a double charge if two requests slipped past the lock.
      if (err?.code === PG_ERRORS.UNIQUE_VIOLATION) {
        throw new HttpError(409, 'This order has already been paid', {
          code: 'ORDER_ALREADY_PAID',
          expose: true,
          details: { orderId },
          cause: err,
        });
      }
      throw err;
    }

    const nextStatus = status === 'succeeded' ? 'paid' : 'payment_failed';
    const {
      rows: [updatedOrder],
    } = await client.query(
      `UPDATE orders
          SET status = $2
        WHERE id = $1
    RETURNING id, status, subtotal_cents, tax_cents, total_cents, currency, updated_at`,
      [order.id, nextStatus],
    );

    // Stock stays reserved on failure so the customer can retry payment on the
    // same order. Releasing it here would mean a retry could find the items
    // gone. Sweeping up orders that are never retried is a separate job.

    log?.info?.('payment attempted', {
      orderId: order.id,
      paymentId: payment.id,
      paymentStatus: payment.status,
      amountCents: order.total_cents,
      cardBrand,
      cardLast4,
      failureCode: payment.failure_code ?? undefined,
    });

    recordPayment({
      status: payment.status,
      failureCode: payment.failure_code,
      durationMs: authorisationMs,
    });

    return {
      payment: toPublicPayment(payment),
      order: {
        id: updatedOrder.id,
        status: updatedOrder.status,
        totals: {
          subtotal: money(updatedOrder.subtotal_cents, updatedOrder.currency),
          tax: money(updatedOrder.tax_cents, updatedOrder.currency),
          total: money(updatedOrder.total_cents, updatedOrder.currency),
        },
        updatedAt: updatedOrder.updated_at,
      },
    };
  });
}

function toPublicPayment(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    status: row.status,
    amount: money(row.amount_cents, row.currency),
    provider: 'mock',
    providerReference: row.provider_reference,
    card: { brand: row.card_brand, last4: row.card_last4 },
    failure: row.failure_code ? { code: row.failure_code, message: row.failure_message } : null,
    createdAt: row.created_at,
  };
}
