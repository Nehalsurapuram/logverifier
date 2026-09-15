import { config } from '../config/index.js';
import { query, withTransaction } from '../database/index.js';
import { HttpError } from '../errors/http-error.js';
import { maybeDelay } from '../simulator/delay.js';
import { recordOrderCreated } from '../metrics/index.js';
import { money } from './money.js';

export async function createOrder(userId, items, log) {
  await maybeDelay('orders.create', log);

  const requestedQuantity = new Map(items.map((item) => [item.productId, item.quantity]));
  const productIds = [...requestedQuantity.keys()];

  return withTransaction(async (client) => {
    // FOR UPDATE holds these rows until the transaction ends, so two orders
    // placed at the same moment cannot both read the same stock and both pass
    // the check below. ORDER BY id fixes the lock acquisition order, which is
    // what stops two overlapping orders from deadlocking each other.
    const { rows: products } = await client.query(
      `SELECT id, sku, name, price_cents, currency, stock, is_active
         FROM products
        WHERE id = ANY($1::uuid[])
        ORDER BY id
          FOR UPDATE`,
      [productIds],
    );

    assertAllProductsExist(productIds, products);
    assertAllProductsPurchasable(products, requestedQuantity);

    const currencies = new Set(products.map((p) => p.currency.trim()));
    if (currencies.size > 1) {
      throw new HttpError(422, 'An order cannot mix currencies', {
        code: 'MIXED_CURRENCY_ORDER',
        expose: true,
        details: { currencies: [...currencies] },
      });
    }

    const currency = [...currencies][0] ?? 'USD';
    const lines = products.map((product) => {
      const quantity = requestedQuantity.get(product.id);
      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        quantity,
        // The price is captured now. Repricing the catalogue tomorrow must not
        // rewrite what this customer agreed to pay today.
        unitPriceCents: product.price_cents,
        lineTotalCents: product.price_cents * quantity,
      };
    });

    const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
    const taxCents = Math.round((subtotalCents * config.commerce.taxRatePercent) / 100);
    const totalCents = subtotalCents + taxCents;

    const {
      rows: [order],
    } = await client.query(
      `INSERT INTO orders (user_id, status, subtotal_cents, tax_cents, total_cents, currency)
            VALUES ($1, 'pending_payment', $2, $3, $4, $5)
         RETURNING id, user_id, status, subtotal_cents, tax_cents, total_cents, currency,
                   created_at, updated_at`,
      [userId, subtotalCents, taxCents, totalCents, currency],
    );

    // UNNEST turns the parallel arrays into rows, so every line item is written
    // by one statement instead of one round trip per item.
    await client.query(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents, line_total_cents)
       SELECT $1, product_id, quantity, unit_price, line_total
         FROM UNNEST($2::uuid[], $3::int[], $4::int[], $5::int[])
                AS t(product_id, quantity, unit_price, line_total)`,
      [
        order.id,
        lines.map((l) => l.productId),
        lines.map((l) => l.quantity),
        lines.map((l) => l.unitPriceCents),
        lines.map((l) => l.lineTotalCents),
      ],
    );

    // Stock is reserved at order time and released again if payment fails.
    // The CHECK (stock >= 0) constraint is the backstop if this ever races.
    await client.query(
      `UPDATE products AS p
          SET stock = p.stock - t.quantity
         FROM UNNEST($1::uuid[], $2::int[]) AS t(product_id, quantity)
        WHERE p.id = t.product_id`,
      [lines.map((l) => l.productId), lines.map((l) => l.quantity)],
    );

    log?.info?.('order created', {
      orderId: order.id,
      itemCount: lines.length,
      totalCents,
    });
    recordOrderCreated({ totalCents });

    return toPublicOrder(order, lines);
  });
}

export async function getOrderById(userId, orderId, log) {
  await maybeDelay('orders.detail', log);

  const { rows } = await query(
    `SELECT o.id, o.user_id, o.status, o.subtotal_cents, o.tax_cents, o.total_cents,
            o.currency, o.created_at, o.updated_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'productId',      oi.product_id,
                  'sku',            p.sku,
                  'name',           p.name,
                  'quantity',       oi.quantity,
                  'unitPriceCents', oi.unit_price_cents,
                  'lineTotalCents', oi.line_total_cents
                ) ORDER BY p.name
              ) FILTER (WHERE oi.id IS NOT NULL),
              '[]'
            ) AS items,
            latest_payment.status     AS payment_status,
            latest_payment.created_at AS payment_at
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products    p  ON p.id = oi.product_id
       -- LATERAL keeps this to the single most recent attempt rather than
       -- multiplying the row out by every payment ever made on the order.
       LEFT JOIN LATERAL (
              SELECT status, created_at
                FROM payments
               WHERE payments.order_id = o.id
               ORDER BY created_at DESC
               LIMIT 1
            ) AS latest_payment ON TRUE
      WHERE o.id = $1 AND o.user_id = $2
      GROUP BY o.id, latest_payment.status, latest_payment.created_at`,
    [orderId, userId],
  );

  // Someone else's order reports as missing rather than forbidden: a 403 would
  // confirm the id exists.
  if (!rows[0]) {
    throw HttpError.notFound('Order not found', { code: 'ORDER_NOT_FOUND' });
  }

  return toPublicOrder(rows[0], rows[0].items, {
    payment: rows[0].payment_status
      ? { status: rows[0].payment_status, at: rows[0].payment_at }
      : null,
  });
}

export async function listOrders(userId, { page, limit }, log) {
  await maybeDelay('orders.list', log);

  const offset = (page - 1) * limit;

  const { rows } = await query(
    `SELECT o.id, o.user_id, o.status, o.subtotal_cents, o.tax_cents, o.total_cents,
            o.currency, o.created_at, o.updated_at,
            COUNT(oi.id)::int AS item_count,
            COUNT(*) OVER()   AS total_count
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.user_id = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC, o.id
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );

  const total = rows[0]?.total_count ?? 0;

  return {
    items: rows.map((row) => ({
      ...toPublicOrder(row, []),
      itemCount: row.item_count,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      hasNextPage: offset + rows.length < total,
    },
  };
}

function assertAllProductsExist(requestedIds, foundProducts) {
  if (foundProducts.length === requestedIds.length) return;

  const found = new Set(foundProducts.map((p) => p.id));
  throw HttpError.notFound('One or more products in the order do not exist', {
    code: 'PRODUCT_NOT_FOUND',
    details: { missingProductIds: requestedIds.filter((id) => !found.has(id)) },
  });
}

function assertAllProductsPurchasable(products, requestedQuantity) {
  const unavailable = products.filter((p) => !p.is_active);
  if (unavailable.length > 0) {
    throw new HttpError(409, 'One or more products are no longer available', {
      code: 'PRODUCT_UNAVAILABLE',
      expose: true,
      details: { productIds: unavailable.map((p) => p.id) },
    });
  }

  const short = products.filter((p) => p.stock < requestedQuantity.get(p.id));
  if (short.length > 0) {
    throw new HttpError(409, 'Insufficient stock for one or more items', {
      code: 'INSUFFICIENT_STOCK',
      expose: true,
      details: {
        items: short.map((p) => ({
          productId: p.id,
          sku: p.sku,
          requested: requestedQuantity.get(p.id),
          available: p.stock,
        })),
      },
    });
  }
}

function toPublicOrder(row, lines, extra = {}) {
  const currency = row.currency;

  return {
    id: row.id,
    status: row.status,
    items: (lines ?? []).map((line) => ({
      productId: line.productId,
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      unitPrice: money(line.unitPriceCents, currency),
      lineTotal: money(line.lineTotalCents, currency),
    })),
    totals: {
      subtotal: money(row.subtotal_cents, currency),
      tax: money(row.tax_cents, currency),
      total: money(row.total_cents, currency),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra,
  };
}
