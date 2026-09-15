import { query } from '../database/index.js';
import { HttpError } from '../errors/http-error.js';
import { maybeDelay } from '../simulator/delay.js';
import { money } from './money.js';

/** Validated sort keys mapped to SQL. Never build ORDER BY from raw input. */
const ORDER_BY = {
  newest: 'created_at DESC',
  price_asc: 'price_cents ASC',
  price_desc: 'price_cents DESC',
  name_asc: 'name ASC',
};

const PRODUCT_COLUMNS = `id, sku, name, description, category, price_cents, currency, stock, created_at`;

export async function listProducts(filters, log) {
  await maybeDelay('products.list', log);

  const { page, limit, category, search, minPrice, maxPrice, sort } = filters;

  // Filters are optional, so the WHERE clause is assembled from whichever were
  // supplied. Values are always bound as parameters; only the sort key is
  // interpolated, and it comes from a fixed map keyed by a validated enum.
  const conditions = ['is_active'];
  const params = [];

  if (category !== undefined) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (search !== undefined) {
    params.push(`%${search}%`);
    conditions.push(`name ILIKE $${params.length}`);
  }
  if (minPrice !== undefined) {
    params.push(minPrice);
    conditions.push(`price_cents >= $${params.length}`);
  }
  if (maxPrice !== undefined) {
    params.push(maxPrice);
    conditions.push(`price_cents <= $${params.length}`);
  }

  const offset = (page - 1) * limit;
  params.push(limit, offset);

  const { rows } = await query(
    `SELECT ${PRODUCT_COLUMNS},
            -- One round trip instead of a separate COUNT query, and the count
            -- is guaranteed consistent with the page it describes.
            COUNT(*) OVER() AS total_count
       FROM products
      WHERE ${conditions.join(' AND ')}
      -- id breaks ties so pagination cannot show or skip a row when two
      -- products share a sort value.
      ORDER BY ${ORDER_BY[sort]}, id
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const total = rows[0]?.total_count ?? 0;

  return {
    items: rows.map(toPublicProduct),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      hasNextPage: offset + rows.length < total,
    },
  };
}

export async function getProductById(id, log) {
  await maybeDelay('products.detail', log);

  const { rows } = await query(
    `SELECT ${PRODUCT_COLUMNS}, updated_at
       FROM products
      WHERE id = $1 AND is_active`,
    [id],
  );

  if (!rows[0]) {
    throw HttpError.notFound('Product not found', { code: 'PRODUCT_NOT_FOUND' });
  }

  // A second query rather than a join: the related list is a different
  // cardinality and joining would duplicate the product row four times.
  const { rows: related } = await query(
    `SELECT ${PRODUCT_COLUMNS}
       FROM products
      WHERE category = $1 AND id <> $2 AND is_active
      ORDER BY created_at DESC
      LIMIT 4`,
    [rows[0].category, id],
  );

  return {
    ...toPublicProduct(rows[0]),
    updatedAt: rows[0].updated_at,
    related: related.map(toPublicProduct),
  };
}

function toPublicProduct(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    category: row.category,
    price: money(row.price_cents, row.currency),
    stock: row.stock,
    inStock: row.stock > 0,
    createdAt: row.created_at,
  };
}
