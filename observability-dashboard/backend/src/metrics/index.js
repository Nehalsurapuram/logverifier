import { Router } from 'express';
import client from 'prom-client';
import { config } from '../config/index.js';
import { getPoolStats } from '../database/pool.js';

/**
 * Prometheus instrumentation.
 *
 * This fills in the seam the codebase was built around: `recordHttpRequest` was
 * already being called for every response by the request logger, so wiring
 * Prometheus changed no call sites at all.
 *
 * Label discipline is the thing to be careful about. Every distinct
 * combination of label values creates a separate time series, so a label fed
 * from user input — a raw URL path, an order id, an email — will eventually
 * exhaust Prometheus's memory. Every label below is drawn from a bounded set:
 * HTTP methods, matched route patterns, status codes, payment outcomes.
 */
export const registry = new client.Registry();

registry.setDefaultLabels({ service: config.serviceName });

// Process and Node runtime metrics: heap, event loop lag, GC, file descriptors.
client.collectDefaultMetrics({ register: registry, prefix: 'app_' });

// ------------------------------------------------------------------ http ---
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code', 'status_class'],
  // Tuned for a web API: sub-10ms is the common case, and the tail past one
  // second is what an anomaly detector should notice.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code', 'status_class'],
  registers: [registry],
});

const httpRequestsInFlight = new client.Gauge({
  name: 'http_requests_in_flight',
  help: 'HTTP requests currently being served',
  registers: [registry],
});

// -------------------------------------------------------------- database ---
const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database statements in seconds',
  labelNames: ['operation', 'outcome'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

const dbErrorsTotal = new client.Counter({
  name: 'db_errors_total',
  help: 'Database statements that failed, by failure kind',
  labelNames: ['kind', 'sqlstate'],
  registers: [registry],
});

// The pool gauges are filled in at scrape time rather than continuously —
// see the collect() hook below.
const dbPoolConnections = new client.Gauge({
  name: 'db_pool_connections',
  help: 'Connections in the pool by state',
  labelNames: ['state'],
  registers: [registry],
});

const dbPoolWaiting = new client.Gauge({
  name: 'db_pool_waiting_requests',
  help: 'Requests queued waiting for a pooled connection; sustained above zero means exhaustion',
  registers: [registry],
});

const dbPoolMax = new client.Gauge({
  name: 'db_pool_max_connections',
  help: 'Configured pool ceiling',
  registers: [registry],
});

// -------------------------------------------------------------- business ---
// Technical metrics tell you the system is slow. These tell you it is losing
// money, which is the signal an operator actually cares about.
const ordersTotal = new client.Counter({
  name: 'orders_created_total',
  help: 'Orders successfully created',
  registers: [registry],
});

const orderValueCents = new client.Histogram({
  name: 'order_value_cents',
  help: 'Order totals in cents',
  buckets: [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000],
  registers: [registry],
});

const paymentsTotal = new client.Counter({
  name: 'payments_total',
  help: 'Payment attempts by outcome',
  labelNames: ['status', 'failure_code'],
  registers: [registry],
});

const paymentDuration = new client.Histogram({
  name: 'payment_duration_seconds',
  help: 'Time spent authorising a payment',
  labelNames: ['status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const simulatedDelaysTotal = new client.Counter({
  name: 'simulated_delay_seconds_total',
  help: 'Artificial latency injected, by operation',
  labelNames: ['operation'],
  registers: [registry],
});

// ----------------------------------------------------------- recorders -----

/** Called by the request logger for every completed response. */
export function recordHttpRequest({ method, route, statusCode, durationMs }) {
  const labels = {
    method,
    route,
    status_code: String(statusCode),
    // A status class makes "is the error rate rising" a single cheap query
    // instead of a sum over every individual code.
    status_class: `${Math.floor(statusCode / 100)}xx`,
  };

  httpRequestDuration.observe(labels, durationMs / 1000);
  httpRequestsTotal.inc(labels);
}

export function trackInFlight() {
  return (_req, res, next) => {
    httpRequestsInFlight.inc();
    res.on('finish', () => httpRequestsInFlight.dec());
    // A client that disconnects mid-request never emits 'finish', and the
    // gauge would drift upward forever without this.
    res.on('close', () => {
      if (!res.writableEnded) httpRequestsInFlight.dec();
    });
    next();
  };
}

export function recordDatabaseQuery({ operation, outcome, durationMs }) {
  dbQueryDuration.observe({ operation, outcome }, durationMs / 1000);
}

export function recordDatabaseError({ kind, sqlstate }) {
  dbErrorsTotal.inc({ kind: kind ?? 'unknown', sqlstate: sqlstate ?? 'none' });
}

export function recordOrderCreated({ totalCents }) {
  ordersTotal.inc();
  orderValueCents.observe(totalCents);
}

export function recordPayment({ status, failureCode, durationMs }) {
  paymentsTotal.inc({ status, failure_code: failureCode ?? 'none' });
  if (durationMs !== undefined) paymentDuration.observe({ status }, durationMs / 1000);
}

export function recordSimulatedDelay({ operation, delayMs }) {
  simulatedDelaysTotal.inc({ operation }, delayMs / 1000);
}

/**
 * Pool state is read at scrape time instead of being pushed on every change.
 * The pool already knows its own counts, so mirroring them continuously would
 * be bookkeeping that can drift out of step with the truth.
 */
dbPoolConnections.collect = function collect() {
  const pool = getPoolStats();
  this.set({ state: 'total' }, pool.total);
  this.set({ state: 'idle' }, pool.idle);
  this.set({ state: 'in_use' }, pool.inUse);
  dbPoolWaiting.set(pool.waiting);
  dbPoolMax.set(pool.max);
};

export function createMetricsRouter() {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.set('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  });

  return router;
}
