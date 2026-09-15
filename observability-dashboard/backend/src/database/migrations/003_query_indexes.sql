-- Indexes matched to the queries the API actually runs, plus one genuine gap.
--
-- PostgreSQL indexes a PRIMARY KEY and a UNIQUE constraint for you. It does
-- NOT index a foreign key. order_items.product_id was therefore unindexed,
-- which means every join from an order to its products, and every attempt to
-- delete a product, sequentially scanned the whole table.
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items (product_id);

-- The default product listing is `WHERE is_active ORDER BY created_at DESC, id`
-- and had no index supporting it at all — the most common query in the API was
-- sorting the entire catalogue on every request.
CREATE INDEX IF NOT EXISTS idx_products_active_created
  ON products (created_at DESC, id) WHERE is_active;

-- sort=price_asc / price_desc, with and without a category filter.
CREATE INDEX IF NOT EXISTS idx_products_active_price
  ON products (price_cents, id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_products_category_price
  ON products (category, price_cents) WHERE is_active;

-- "recent orders in state X" — the shape every operational dashboard asks for.
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status_created ON payments (status, created_at DESC);

-- Both of these are now strict prefixes of a composite above, so they can only
-- cost write throughput and disk. A redundant index is not free.
DROP INDEX IF EXISTS idx_products_price;
DROP INDEX IF EXISTS idx_orders_status;
