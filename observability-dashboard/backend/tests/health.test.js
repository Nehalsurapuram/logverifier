import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { closePool } from '../src/database/index.js';

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await closePool();
  server.close();
});

describe('GET /health', () => {
  it('returns 200 with service status and a valid timestamp', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.service, 'string');
    assert.equal(typeof body.version, 'string');
    assert.ok(Number.isInteger(body.uptimeSeconds));
    assert.equal(new Date(body.timestamp).toISOString(), body.timestamp);
  });

  it('stays up regardless of dependencies', async () => {
    // Liveness must not probe the database, or an outage would get the
    // container killed instead of merely drained.
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
  });
});

describe('GET /health/ready', () => {
  it('reports each dependency and matches its status code to them', async () => {
    const res = await fetch(`${baseUrl}/health/ready`);
    const body = await res.json();

    // Whether PostgreSQL is actually running decides the code, so assert the
    // relationship rather than a fixed value.
    assert.ok(['up', 'down'].includes(body.dependencies.database.status));
    const expectReady = body.dependencies.database.status === 'up';

    assert.equal(body.status, expectReady ? 'ready' : 'not_ready');
    assert.equal(res.status, expectReady ? 200 : 503);
  });
});

describe('request correlation', () => {
  it('returns a generated request id on every response', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.match(res.headers.get('x-request-id'), /^[\w-]{36}$/);
  });

  it('keeps a well-formed inbound request id', async () => {
    const res = await fetch(`${baseUrl}/health`, { headers: { 'x-request-id': 'trace-abc-123' } });
    assert.equal(res.headers.get('x-request-id'), 'trace-abc-123');
  });

  it('replaces a malformed inbound request id', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { 'x-request-id': 'spaces and $ymbols' },
    });
    assert.notEqual(res.headers.get('x-request-id'), 'spaces and $ymbols');
  });
});

describe('error handling', () => {
  it('answers an unknown route with a structured 404 carrying the request id', async () => {
    const res = await fetch(`${baseUrl}/definitely-not-a-route`);
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'ROUTE_NOT_FOUND');
    assert.equal(body.error.status, 404);
    assert.equal(body.error.requestId, res.headers.get('x-request-id'));
    assert.equal(new Date(body.error.timestamp).toISOString(), body.error.timestamp);
  });
});

describe('metrics', () => {
  it('exposes Prometheus metrics in the exposition format', async () => {
    // Make a request first, so the counters have something in them.
    await fetch(`${baseUrl}/health`);
    const res = await fetch(`${baseUrl}/metrics`);
    const body = await res.text();

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/plain/);

    // HELP and TYPE lines are what make a scrape self-describing.
    assert.match(body, /# HELP http_requests_total/);
    assert.match(body, /# TYPE http_request_duration_seconds histogram/);
    assert.match(body, /http_requests_total\{[^}]*route="\/health"[^}]*\}/);
    // Node runtime metrics come along for free and are worth having.
    assert.match(body, /app_nodejs_eventloop_lag_seconds/);
    // Pool gauges are filled in at scrape time by a collect() hook.
    assert.match(body, /db_pool_max_connections/);
  });

  it('labels metrics only with bounded values', async () => {
    // An unmatched path must never become its own label value, or any caller
    // could invent unlimited time series and exhaust Prometheus.
    const nonce = `not-a-route-${Date.now()}`;
    await fetch(`${baseUrl}/${nonce}`);
    const body = await (await fetch(`${baseUrl}/metrics`)).text();

    assert.match(body, /route="\(unmatched\)"/);
    assert.equal(body.includes(nonce), false);
  });
});

describe('extension points', () => {

  it('declares the simulator as not implemented yet', async () => {
    const res = await fetch(`${baseUrl}/api/simulate/latency`, { method: 'POST' });
    const body = await res.json();

    assert.equal(res.status, 501);
    assert.equal(body.error.code, 'SIMULATOR_NOT_IMPLEMENTED');
  });
});
