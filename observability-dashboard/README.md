# AI-Assisted Observability Dashboard

A sample e-commerce storefront and payment backend, built to be *monitored*. Later phases add Prometheus
metrics, Loki log shipping, Grafana dashboards and an LLM that correlates them into root-cause
analysis. This phase delivers the application those tools will watch.

It is deliberately realistic: real SQL with transactions and row locking, stock that can run out,
cards that get declined, a provider that sometimes fails, and one switch that makes everything
slow on command.

```
Browser → nginx ─┬─ React storefront (static files)
                 │
                 └─ /api → Express ──→ PostgreSQL
                              │
                              ├── stdout (JSON lines) → Loki       ─┐ (later)
                              └── /metrics            → Prometheus ─┴→ AI → root cause
```

## Prerequisites

- [Node.js 22 LTS](https://nodejs.org/) or newer
- [Docker Desktop](https://docs.docker.com/desktop/) for the containerised path

## Quick start — Docker

```bash
cp .env.example .env
docker compose up -d --build
```

Then open **http://localhost:8080** — that is the shop.

| URL                     | What it is                                   |
| ----------------------- | -------------------------------------------- |
| http://localhost:8080   | Storefront (React, served by nginx)          |
| http://localhost:4000   | API directly, if you want to curl it         |
| http://localhost:8080/status | Live service, database and pool status  |

PostgreSQL comes up first, the backend migrates and seeds twelve products, then nginx starts and
proxies `/api` to it.

```bash
docker compose ps                  # all three containers, with health
docker compose logs -f backend     # JSON logs
docker compose down                # stop  (-v also drops the database volume)
```

### What you can do in the shop

Browse and filter the catalogue, open a product, add to a cart, register, check out, and pay.
Checkout is two steps because the backend models it that way: **placing the order reserves stock**,
**paying it** is a separate attempt that can fail and be retried against the same order.

The payment form offers the sandbox cards, so every failure path is one dropdown away:

| Card                 | What happens                                   |
| -------------------- | ---------------------------------------------- |
| `4242…4242`          | succeeds, order becomes `paid`                 |
| `4000…0002`          | `402` declined — order stays retryable         |
| `4000…9995`          | `402` insufficient funds                       |
| `4000…0119`          | `502` provider failure                         |

When anything fails, the UI shows the error **with its `requestId`** — the same id stamped on every
log line that request produced. Read it off the screen, paste it into a log query, and you have the
whole story. That is the point of the correlation plumbing, and a UI that swallowed it would waste it.

**http://localhost:8080/status** polls `/health` every three seconds and shows database latency and
live pool saturation — useful for watching `waiting` climb while you generate load.

> **Port 5432 already taken?** Very likely if you have PostgreSQL installed locally — the host
> server will shadow the container and you will get `password authentication failed`. Set
> `POSTGRES_PORT=5433` in `.env`. Compose publishes on whatever you set, and the app and test
> suite follow; inside the compose network it stays 5432 either way.

## Quick start — local

```bash
cp .env.example .env
docker compose up -d postgres      # just the database

# terminal 1 — API on :4000
cd backend && npm install && npm run db:migrate && npm run dev

# terminal 2 — storefront on :5173, hot reloading
cd frontend && npm install && npm run dev
```

The Vite dev server proxies `/api` and `/health` to `localhost:4000`, exactly as nginx does in
production. The browser only ever talks to one origin, so CORS never enters the picture.

## Tests

```bash
cd backend
npm test
```

104 tests. The database-backed suites **skip with an explanation** rather than fail if PostgreSQL is
unreachable, so `npm test` still says something useful on a machine with nothing running. They
create their own fixture products and delete everything they made, so repeated runs neither drain
the demo catalogue nor leave debris.

---

# API

## Response envelope

Every `/api` response uses one of two shapes, so a client parses the same structure either way.

```jsonc
// success
{ "data": { ... }, "meta": { "requestId": "8054ac20-...", "timestamp": "2026-09-15T07:56:59.584Z" } }

// failure
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "...", "status": 409,
             "requestId": "8054ac20-...", "timestamp": "...", "details": { ... } } }
```

The `requestId` also comes back as the `x-request-id` header and is stamped on every log line the
request produced — paste it into a log query and you have the whole story.

The `/health` probes deliberately keep a bare, unwrapped shape: they answer orchestrators and
uptime checks, not API clients.

Money is always an object: `amountCents` to compute with, `formatted` to display.

```json
{ "amountCents": 17998, "currency": "USD", "formatted": "179.98 USD" }
```

## Health

### `GET /health` — liveness

Reports the database and pool, but **never queries them** — it serves a reading refreshed by a
background probe, so it cannot block or fail when PostgreSQL is down. Always 200.

```bash
curl -s http://localhost:4000/health
```
```json
{"status":"ok","service":"observability-backend","version":"0.1.0",
 "environment":"development","uptimeSeconds":42,"timestamp":"2026-09-15T08:10:19.994Z",
 "dependencies":{"database":{"status":"up","latencyMs":1,"checkedAt":"...","cached":true,
   "pool":{"max":10,"min":0,"total":1,"idle":1,"inUse":0,
           "waiting":0,"saturated":false,"utilisationPercent":0}}}}
```

`status` is about the *process*, not its dependencies: a liveness probe that fails during a
database outage causes a restart loop. Use `/health/ready` to decide whether to route traffic.

### `GET /health/ready` — readiness

Probes the database live (`cached: false`). Returns **503** when any dependency is down.

```bash
curl -s http://localhost:4000/health/ready
```
```json
{"status":"ready","service":"observability-backend",
 "dependencies":{"database":{"status":"up","latencyMs":1,"cached":false,
   "pool":{"max":10,"idle":1,"waiting":0,"saturated":false}}},"timestamp":"..."}
```

Neither endpoint exposes the connection string, host, user or password. See
[Database health](#database-health).

## Authentication

Tokens are JWTs signed with `JWT_SECRET`. Send them as `Authorization: Bearer <token>`.

### `POST /api/auth/register` → 201

Registering also signs you in, so a client need not immediately call `/login`.

```bash
curl -s -X POST http://localhost:4000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","name":"Ada Lovelace","password":"correct-horse-battery-staple"}'
```
```json
{"data":{"user":{"id":"5964d962-...","email":"ada@example.com","name":"Ada Lovelace",
 "createdAt":"..."},"token":"eyJhbGciOi...","tokenType":"Bearer","expiresIn":"1h"},
 "meta":{"requestId":"...","timestamp":"..."}}
```

| Field      | Rules                                              |
| ---------- | -------------------------------------------------- |
| `email`    | valid address, trimmed and lowercased, ≤ 254 chars  |
| `name`     | 1–120 chars                                        |
| `password` | 10–200 chars                                       |

Errors: `400 VALIDATION_ERROR`, `409 EMAIL_ALREADY_REGISTERED`.

### `POST /api/auth/login` → 200

```bash
curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse-battery-staple"}'
```

Errors: `401 INVALID_CREDENTIALS` — identical for an unknown email and a wrong password, because
any difference between the two is an account-enumeration oracle.

### `GET /api/auth/me` → 200 (auth required)

```bash
curl -s http://localhost:4000/api/auth/me -H "authorization: Bearer $TOKEN"
```

Errors: `401 UNAUTHORIZED` (no header), `401 TOKEN_INVALID`, `401 TOKEN_EXPIRED`.

## Products

Public — browsing needs no account.

### `GET /api/products` → 200

```bash
curl -s "http://localhost:4000/api/products?category=audio&sort=price_asc&limit=3"
curl -s "http://localhost:4000/api/products?search=keyboard&minPrice=5000&maxPrice=20000"
```

| Query      | Default  | Notes                                                    |
| ---------- | -------- | -------------------------------------------------------- |
| `page`     | 1        |                                                          |
| `limit`    | 20       | max 100                                                   |
| `category` | —        | exact match                                              |
| `search`   | —        | case-insensitive match on name, trigram-indexed           |
| `minPrice` | —        | integer **cents**                                        |
| `maxPrice` | —        | must be ≥ `minPrice`                                     |
| `sort`     | `newest` | `newest`, `price_asc`, `price_desc`, `name_asc`           |

```json
{"data":{"items":[{"id":"...","sku":"AUD-003","name":"Desktop USB Microphone",
  "category":"audio","price":{"amountCents":8999,"currency":"USD","formatted":"89.99 USD"},
  "stock":65,"inStock":true}],
  "pagination":{"page":1,"limit":3,"total":3,"totalPages":1,"hasNextPage":false}},
 "meta":{...}}
```

An unknown `sort` is a `400`, not a silent fallback. Out-of-stock products are still listed, with
`inStock: false` — hiding them would make the catalogue lie.

### `GET /api/products/:id` → 200

Includes up to four related products from the same category.

```bash
curl -s http://localhost:4000/api/products/$PRODUCT_ID
```

Errors: `400 VALIDATION_ERROR` (not a UUID), `404 PRODUCT_NOT_FOUND`.

## Orders

All order routes require authentication and are scoped to the caller.

### `POST /api/orders` → 201

Runs in one transaction: lock the product rows, verify stock, write the order and its items,
decrement stock. Concurrent orders cannot oversell.

```bash
curl -s -X POST http://localhost:4000/api/orders \
  -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
  -d '{"items":[{"productId":"'$PRODUCT_ID'","quantity":2}]}'
```
```json
{"data":{"id":"...","status":"pending_payment",
  "items":[{"sku":"AUD-003","quantity":2,
    "unitPrice":{"formatted":"89.99 USD"},"lineTotal":{"formatted":"179.98 USD"}}],
  "totals":{"subtotal":{"formatted":"179.98 USD"},
            "tax":{"formatted":"15.30 USD"},
            "total":{"formatted":"195.28 USD"}}},
 "meta":{...}}
```

Prices are copied onto the line items at purchase time, so repricing the catalogue tomorrow cannot
rewrite what a customer agreed to pay today.

Errors:

| Status | Code                   | When                                                     |
| ------ | ---------------------- | -------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`     | empty items, same product twice, bad quantity             |
| 401    | `UNAUTHORIZED`         | no token                                                 |
| 404    | `PRODUCT_NOT_FOUND`    | an item references a product that does not exist          |
| 409    | `INSUFFICIENT_STOCK`   | `details.items[]` reports `requested` vs `available`      |
| 409    | `PRODUCT_UNAVAILABLE`  | product is deactivated                                   |
| 422    | `MIXED_CURRENCY_ORDER` | items priced in different currencies                      |

### `GET /api/orders` → 200

```bash
curl -s "http://localhost:4000/api/orders?page=1&limit=20" -H "authorization: Bearer $TOKEN"
```

### `GET /api/orders/:id` → 200

Returns line items plus the most recent payment attempt.

```bash
curl -s http://localhost:4000/api/orders/$ORDER_ID -H "authorization: Bearer $TOKEN"
```

Another user's order returns **404, not 403** — a 403 would confirm the id exists.

## Payments

### `POST /api/payments` → 201

Charges an order. The card number is validated with a Luhn checksum before the provider is called,
and only the brand and last four digits are ever stored or logged.

```bash
curl -s -X POST http://localhost:4000/api/payments \
  -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
  -d '{"orderId":"'$ORDER_ID'","card":{"number":"4242 4242 4242 4242",
       "expiryMonth":12,"expiryYear":2030,"cvc":"123","holderName":"Ada Lovelace"}}'
```
```json
{"data":{"payment":{"id":"...","status":"succeeded",
   "amount":{"formatted":"195.28 USD"},"providerReference":"ch_9f2c...",
   "card":{"brand":"visa","last4":"4242"},"failure":null},
  "order":{"id":"...","status":"paid"}},
 "meta":{...}}
```

**Test cards** — deterministic, like a real gateway's sandbox:

| Number             | Outcome                                    |
| ------------------ | ------------------------------------------- |
| `4242424242424242` | succeeds (any other Luhn-valid number too)   |
| `4000000000000002` | `402` declined — `card_declined`             |
| `4000000000009995` | `402` declined — `insufficient_funds`        |
| `4000000000000119` | `502` provider failure — `processing_error`  |

Errors:

| Status | Code                       | Meaning                                                          |
| ------ | -------------------------- | ----------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`         | failed checksum, expired card, malformed CVC                      |
| 401    | `UNAUTHORIZED`             | no token                                                          |
| 402    | `PAYMENT_DECLINED`         | the card was judged and refused — try a different card            |
| 404    | `ORDER_NOT_FOUND`          | unknown order, or one belonging to someone else                   |
| 409    | `ORDER_ALREADY_PAID`       | also enforced by a partial unique index in the database           |
| 409    | `ORDER_NOT_PAYABLE`        | the order is cancelled                                            |
| 502    | `PAYMENT_PROVIDER_ERROR`   | the provider never answered — the same card may work on retry     |

402 and 502 are different on purpose: one means *this card will not work*, the other means *try
again*. A failed attempt leaves the order `payment_failed` and **retryable**; stock stays reserved
so the retry cannot find the items gone.

Every attempt is recorded, including failures — the failure row is committed before the error is
raised, so the evidence survives the error response.

## Extension points (not implemented)

| Endpoint            | Status | Phase                           |
| ------------------- | ------ | ------------------------------- |
| `GET /metrics`      | 501    | Prometheus                      |
| `/api/simulate/*`   | 501    | Failure simulator control plane |

---

## Simulating failure and latency

The only artificial latency in the service goes through one switch. Nothing in the request path
sleeps unless you ask for it.

```bash
SIMULATED_DELAY_ENABLED=true
SIMULATED_DELAY_MIN_MS=200
SIMULATED_DELAY_MAX_MS=1500
PAYMENT_FAILURE_RATE=0.25      # decline a quarter of payments at random
```

```bash
docker compose up -d           # compose passes these through to the backend
```

Instrumented points log the operation and the delay applied: `auth.register`, `auth.login`,
`products.list`, `products.detail`, `orders.create`, `orders.detail`, `orders.list`,
`payments.authorize`.

## Configuration

Everything lives in `.env`; see `.env.example` for the annotated list. The ones that matter most:

| Variable                  | Default   | Notes                                                        |
| ------------------------- | --------- | ------------------------------------------------------------ |
| `JWT_SECRET`              | —         | **Required in production**, min 32 chars; the service refuses to start otherwise |
| `POSTGRES_PORT`           | 5432      | change to 5433 if a local PostgreSQL owns 5432                |
| `DB_AUTO_MIGRATE`         | false     | compose sets `true`; run `npm run db:migrate` otherwise        |
| `TAX_RATE_PERCENT`        | 8.5       | applied to the order subtotal                                 |
| `SIMULATED_DELAY_ENABLED` | false     | master switch for artificial latency                          |
| `PAYMENT_FAILURE_RATE`    | 0         | 0–1                                                          |

Outside production a missing `JWT_SECRET` falls back to a development default and logs a warning
at startup. In production that combination is refused — a deployment signing sessions with a key
published in this repository would let anyone mint a valid token.

## Database

Money is stored as integer cents throughout. Floats and money do not mix.

```
users ──< orders ──< order_items >── products
              └────< payments
```

### Schema

```sql
users
  id            UUID PK           products
  email         TEXT UNIQUE         id          UUID PK
  name          TEXT                sku         TEXT UNIQUE
  password_hash TEXT                name        TEXT
  created_at    TIMESTAMPTZ         description TEXT
  updated_at    TIMESTAMPTZ         category    TEXT
                                    price_cents INTEGER  CHECK (>= 0)
orders                              currency    CHAR(3)
  id             UUID PK            stock       INTEGER  CHECK (>= 0)
  user_id        UUID → users       is_active   BOOLEAN
  status         TEXT   CHECK (pending_payment|paid|payment_failed|cancelled)
  subtotal_cents INTEGER          order_items
  tax_cents      INTEGER            id               UUID PK
  total_cents    INTEGER            order_id         UUID → orders  ON DELETE CASCADE
  currency       CHAR(3)            product_id       UUID → products
  created_at     TIMESTAMPTZ        quantity         INTEGER CHECK (> 0)
  updated_at     TIMESTAMPTZ        unit_price_cents INTEGER
                                    line_total_cents INTEGER
payments                            UNIQUE (order_id, product_id)
  id                 UUID PK
  order_id           UUID → orders ON DELETE CASCADE
  status             TEXT CHECK (succeeded|declined|failed)
  amount_cents       INTEGER
  currency           CHAR(3)
  provider           TEXT
  provider_reference TEXT
  card_brand         TEXT        ← brand and last four ONLY
  card_last4         CHAR(4)
  failure_code       TEXT
  failure_message    TEXT
  created_at         TIMESTAMPTZ
```

`users.updated_at`, `products.updated_at` and `orders.updated_at` are maintained by a
`set_updated_at()` trigger rather than by every query remembering to set them.

### Indexes

| Index                               | Table         | Serves                                        |
| ----------------------------------- | ------------- | --------------------------------------------- |
| `users_email_key`                   | users         | login lookup (from `UNIQUE`)                   |
| `products_sku_key`                  | products      | seed idempotency (from `UNIQUE`)               |
| `idx_products_active_created`       | products      | default listing, `ORDER BY created_at DESC, id`|
| `idx_products_active_price`         | products      | `sort=price_asc` / `price_desc`                |
| `idx_products_category_price`       | products      | `?category=…` combined with a price sort       |
| `idx_products_category`             | products      | plain category filter                          |
| `idx_products_name_trgm`            | products      | `?search=…` ILIKE, trigram GIN                 |
| `idx_orders_user_created`           | orders        | "my orders", newest first                      |
| `idx_orders_status_created`         | orders        | recent orders in a given state                 |
| `idx_order_items_order`             | order_items   | order detail join                              |
| `idx_order_items_product`           | order_items   | **the FK join** — see below                    |
| `idx_payments_order`                | payments      | latest payment per order (LATERAL)             |
| `idx_payments_status_created`       | payments      | payment reporting                              |
| `uniq_successful_payment_per_order` | payments      | partial unique — no double charge              |

Three things worth calling out:

- **PostgreSQL does not index foreign keys.** It creates indexes for primary keys and unique
  constraints, and nothing else. `order_items.product_id` was therefore unindexed, so every join
  from an order to its products sequentially scanned the table. Fixed in `003_query_indexes.sql`.
- **The default product listing had no supporting index at all** — the most frequent query in the
  API was sorting the whole catalogue on every request.
- **Two indexes were dropped**, not added. `idx_products_price` and `idx_orders_status` became
  strict prefixes of new composite indexes, so they could only cost write throughput.

### Integrity rules the database enforces itself

- **`FOR UPDATE` on products during order creation** — two simultaneous orders cannot both read
  the same stock and both pass the check. Rows are locked in `id` order so overlapping orders
  cannot deadlock each other.
- **A partial unique index** (`payments(order_id) WHERE status = 'succeeded'`) makes a double
  charge impossible at the database level, whatever the application believes.
- **`order_items` has no `ON DELETE CASCADE` to products** — deliberately. Deleting a product must
  not erase the history of orders that contained it.
- **`CHECK (stock >= 0)`** and `CHECK (price_cents >= 0)` are the backstop if the application
  logic above is ever circumvented.

### Connection pool

Configured entirely from the environment and reported live on `/health`:

| Variable                   | Default | Purpose                                                  |
| -------------------------- | ------- | -------------------------------------------------------- |
| `DB_POOL_MAX`              | 10      | connection ceiling — **lower it to force exhaustion**     |
| `DB_POOL_MIN`              | 0       | connections kept warm                                     |
| `DB_CONNECTION_TIMEOUT_MS` | 5000    | wait for a free connection before failing with 503        |
| `DB_IDLE_TIMEOUT_MS`       | 30000   | when an idle connection is closed                         |
| `DB_STATEMENT_TIMEOUT_MS`  | 15000   | server-side query ceiling (PostgreSQL cancels it)         |
| `DB_QUERY_TIMEOUT_MS`      | 15000   | client-side ceiling, if the server never answers          |
| `DB_SLOW_QUERY_MS`         | 500     | statements at or above this are logged as slow            |
| `DB_HEALTH_INTERVAL_MS`    | 10000   | background probe interval for the cached `/health` reading |

To simulate pool exhaustion:

```bash
DB_POOL_MAX=1 DB_CONNECTION_TIMEOUT_MS=40 docker compose up -d --force-recreate backend
```

Then drive concurrent traffic. Requests queue for the single connection, and any that wait longer
than the acquisition timeout get a **503 `DATABASE_UNAVAILABLE`** rather than hanging forever —
fail fast, with a status that tells the caller to retry. `/health` shows `waiting` climbing and
`saturated: true` while it happens.

### Database health

`/health` reports the database but **never queries it**. A background probe refreshes a cached
reading every `DB_HEALTH_INTERVAL_MS`, and the endpoint serves that.

This matters: a liveness probe that blocks on a dependency turns a database outage into a restart
loop, because the orchestrator times the probe out and kills a container that was working fine.
So `/health` stays `"status": "ok"` and 200 whatever the database is doing — it answers *should
you restart me*. Whether traffic should be routed is `/health/ready`, which probes live and
returns 503 when the database is down.

```jsonc
// GET /health
"dependencies": { "database": {
  "status": "up", "latencyMs": 1, "checkedAt": "...", "cached": true,
  "pool": { "max": 10, "min": 0, "total": 1, "idle": 1, "inUse": 0,
            "waiting": 0, "saturated": false, "utilisationPercent": 0 } } }
```

Everything there describes capacity and latency. The host, user, password and connection string
are absent by construction.

### Errors that are safe to log

PostgreSQL error objects are **not** safe to log wholesale. The `detail` field quotes the offending
value back at you:

```
detail: 'Key (email)=(ada@example.com) already exists.'
```

Log that and every duplicate registration writes a customer's email address into your log
aggregator. `where`, `hint` and `internalQuery` leak the same way.

So `src/database/errors.js` rebuilds driver errors by **allowlist**: `code`, `constraint`, `table`,
`column`, `routine` and `severity` are copied — structural identifiers that contain no user data —
and everything else is dropped. What survives passes through a redactor that strips
`postgresql://user:pass@host` credentials and `password=…` assignments.

The statement text *is* logged, and safely, precisely because every value is a bound parameter.
`WHERE email = $1` tells you what ran; the address bound to `$1` never appears. Statements slower
than `DB_SLOW_QUERY_MS` are logged with their duration and row count.

### Migrations and resetting

Migrations live in `backend/src/database/migrations/` and run in filename order, each inside its
own transaction together with the row that records it — a failure leaves nothing half-applied.

```bash
cd backend
npm run db:migrate        # apply anything pending (idempotent)
npm run db:reset          # DROP every table, then rebuild and reseed
```

`db:reset` drops `payments, order_items, orders, products, users, schema_migrations CASCADE`, then
replays every migration. It **refuses to run when `NODE_ENV=production`** unless
`DB_RESET_FORCE=true` is also set.

Three ways to reset, in increasing severity:

| Command                                   | Effect                                              |
| ----------------------------------------- | ---------------------------------------------------- |
| `npm run db:reset`                        | tables dropped and rebuilt; the volume survives       |
| `docker compose down -v && docker compose up -d --build` | deletes the PostgreSQL volume entirely |
| `docker exec observability-postgres psql -U observability -d observability` | poke at it by hand |

After a reset the catalogue is reseeded to its original twelve products and every user, order and
payment is gone.

## File tree

```
observability-dashboard/
├── .env.example                    Annotated list of every variable
├── docker-compose.yml              postgres + backend + frontend, ordered by health
├── frontend/
│   ├── Dockerfile                  Vite build → nginx; no Node in the final image
│   ├── nginx.conf                  SPA fallback, /api proxy, asset caching
│   └── src/
│       ├── lib/api.js              Envelope unwrapping, keeps requestId on errors
│       ├── context/                Auth session and cart (both browser-side)
│       ├── pages/                  Catalogue, product, cart, checkout, orders, status
│       └── components/             Layout and the error banner
└── backend/
    ├── Dockerfile                  Multi-stage Node 22 Alpine, non-root
    ├── src/
    │   ├── index.js                Entrypoint: migrate, listen, graceful shutdown
    │   ├── app.js                  Express app factory — middleware order lives here
    │   ├── config/                 Loads and validates .env into a frozen object
    │   ├── routes/                 URL shape only; one router per resource
    │   ├── controllers/            Validated input in, HTTP response out
    │   ├── services/               All business logic and SQL
    │   │   ├── auth.service.js     scrypt hashing, JWT issuing
    │   │   ├── product.service.js  Filtering, pagination, related products
    │   │   ├── order.service.js    The order transaction
    │   │   ├── payment.service.js  Charge, record, update order
    │   │   ├── mock-payment-provider.js
    │   │   └── money.js
    │   ├── database/
    │   │   ├── index.js            query() and withTransaction(), timing and slow-query logs
    │   │   ├── pool.js             Pool configuration, live saturation stats
    │   │   ├── errors.js           Allowlist rebuild of driver errors + secret redaction
    │   │   ├── health.js           Background probe + cached reading for /health
    │   │   ├── migrate.js          Applies migrations, each in its own transaction
    │   │   ├── reset.js            Drops and rebuilds (refuses in production)
    │   │   └── migrations/         001 schema · 002 seed · 003 query indexes
    │   ├── validation/             zod schemas, one per resource
    │   ├── middleware/             request-id, logger, respond, validate, auth, errors
    │   ├── errors/                 HttpError
    │   ├── logger/                 JSON-lines logger
    │   ├── metrics/                Prometheus seam (501)
    │   ├── simulator/              The delay mechanism + simulator seam (501)
    │   └── ai/                     LLM analyzer interface, vendor-free
    └── tests/                      104 tests across 8 files
```

Layering rule: **routes** declare URLs, **controllers** translate HTTP, **services** own the logic
and the SQL. Nothing below the controller knows what an HTTP request is, and nothing above the
service writes SQL.

## Roadmap

1. Foundation — health, request ids, error handling
2. **E-commerce and payment API** ← you are here
3. Prometheus metrics (`src/metrics/`)
4. Loki log shipping
5. Grafana dashboards
6. Failure simulator control plane (`src/simulator/`)
7. Anomaly detection
8. LLM analysis (`src/ai/`)
