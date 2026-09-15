-- Core e-commerce schema: users, products, orders, order_items, payments.
-- Money is stored in integer cents. Floating point money is a bug waiting to
-- happen, and every total here is derived by summing integers.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Keeps updated_at honest without every query having to remember it.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- users ----
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------- products ----
CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  category    TEXT        NOT NULL,
  price_cents INTEGER     NOT NULL CHECK (price_cents >= 0),
  currency    CHAR(3)     NOT NULL DEFAULT 'USD',
  stock       INTEGER     NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS products_set_updated_at ON products;
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_products_category ON products (category) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_products_price    ON products (price_cents) WHERE is_active;
-- Trigram index so the ILIKE search in the listing endpoint stays index-backed
-- instead of degrading into a sequential scan as the catalogue grows.
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);

-- --------------------------------------------------------------- orders ----
CREATE TABLE IF NOT EXISTS orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status         TEXT        NOT NULL DEFAULT 'pending_payment'
                 CHECK (status IN ('pending_payment', 'paid', 'payment_failed', 'cancelled')),
  subtotal_cents INTEGER     NOT NULL CHECK (subtotal_cents >= 0),
  tax_cents      INTEGER     NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents    INTEGER     NOT NULL CHECK (total_cents >= 0),
  currency       CHAR(3)     NOT NULL DEFAULT 'USD',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS orders_set_updated_at ON orders;
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders (status);

-- ---------------------------------------------------------- order_items ----
CREATE TABLE IF NOT EXISTS order_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID    NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id       UUID    NOT NULL REFERENCES products (id),
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  -- Price is copied at purchase time: a later price change must not silently
  -- rewrite the history of an order that was already placed.
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  UNIQUE (order_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

-- ------------------------------------------------------------- payments ----
CREATE TABLE IF NOT EXISTS payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID        NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  status             TEXT        NOT NULL CHECK (status IN ('succeeded', 'declined', 'failed')),
  amount_cents       INTEGER     NOT NULL CHECK (amount_cents >= 0),
  currency           CHAR(3)     NOT NULL,
  provider           TEXT        NOT NULL DEFAULT 'mock',
  provider_reference TEXT,
  -- Only ever the brand and last four digits. A full card number must never
  -- reach this database or the logs.
  card_brand         TEXT,
  card_last4         CHAR(4),
  failure_code       TEXT,
  failure_message    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payments (order_id, created_at DESC);

-- Database-level guarantee that one order cannot be charged twice, independent
-- of whatever the application layer believes.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_successful_payment_per_order
  ON payments (order_id) WHERE status = 'succeeded';
