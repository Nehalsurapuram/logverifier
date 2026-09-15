import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { requestId } from '../src/middleware/request-id.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { HttpError } from '../src/errors/http-error.js';
import { isConnectionError } from '../src/database/index.js';

let server;
let baseUrl;

// A throwaway app, because the real one deliberately exposes no route that
// fails — these paths still have to be proven.
before(async () => {
  const app = express();
  app.use(requestId());
  app.get('/throws', () => {
    throw new Error('internal detail that must not leak');
  });
  app.get('/rejects', async () => {
    throw new Error('async internal detail');
  });
  app.get('/bad-request', () => {
    throw HttpError.badRequest('id must be a number', { details: { field: 'id' } });
  });
  app.use(errorHandler());

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

describe('centralized error handling', () => {
  it('turns an unexpected throw into a structured 500', async () => {
    const res = await fetch(`${baseUrl}/throws`);
    const body = await res.json();

    assert.equal(res.status, 500);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.equal(body.error.requestId, res.headers.get('x-request-id'));
  });

  it('catches a rejected async handler without any try/catch in the route', async () => {
    // This is Express 5 behaviour and the reason no asyncHandler wrapper exists.
    const res = await fetch(`${baseUrl}/rejects`);
    assert.equal(res.status, 500);
  });

  it('passes through the status and details of a deliberate client error', async () => {
    const res = await fetch(`${baseUrl}/bad-request`);
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.error.message, 'id must be a number');
    assert.deepEqual(body.error.details, { field: 'id' });
  });
});

describe('database failure classification', () => {
  // These are the literal errors node-postgres produces when the server is
  // gone. Getting this wrong means a dependency outage is reported as 500,
  // telling callers not to retry something they should retry.
  it('recognises pool errors that carry no error code', () => {
    assert.equal(isConnectionError(new Error('Connection terminated due to connection timeout')), true);
    assert.equal(isConnectionError(new Error('timeout exceeded when trying to connect')), true);
    assert.equal(isConnectionError(new Error('Connection terminated unexpectedly')), true);
  });

  it('recognises socket and SQLSTATE connection codes', () => {
    assert.equal(isConnectionError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), true);
    assert.equal(isConnectionError(Object.assign(new Error('x'), { code: '57P03' })), true);
  });

  it('does not mistake a query error for an outage', () => {
    // A unique violation is the database working correctly and saying no.
    assert.equal(isConnectionError(Object.assign(new Error('duplicate key'), { code: '23505' })), false);
    assert.equal(isConnectionError(new Error('syntax error at or near "slect"')), false);
    assert.equal(isConnectionError(null), false);
  });
});

describe('HttpError', () => {
  it('exposes client error messages and withholds server ones by default', () => {
    assert.equal(HttpError.badRequest('nope').expose, true);
    assert.equal(new HttpError(500, 'db password wrong').expose, false);
  });

  it('exposes 501 on purpose, since it describes a missing feature', () => {
    assert.equal(HttpError.notImplemented('later').expose, true);
  });

  it('defaults the error code from the status class', () => {
    assert.equal(HttpError.notFound().code, 'REQUEST_ERROR');
    assert.equal(new HttpError(500, 'boom').code, 'INTERNAL_ERROR');
  });

  it('keeps the original error reachable as cause', () => {
    const cause = new Error('socket closed');
    assert.equal(new HttpError(503, 'db down', { cause }).cause, cause);
  });
});
