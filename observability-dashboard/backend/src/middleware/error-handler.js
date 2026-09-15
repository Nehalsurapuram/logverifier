import { config } from '../config/index.js';
import { isConnectionError } from '../database/index.js';
import { HttpError } from '../errors/http-error.js';

/**
 * The one place an error becomes a response.
 *
 * Express 5 forwards rejected promises from async handlers here automatically,
 * so controllers can just throw and no route needs a try/catch.
 */
export function errorHandler() {
  return (err, req, res, next) => {
    // Headers already flushed: Express must abort the connection, not re-reply.
    if (res.headersSent) {
      next(err);
      return;
    }

    // A database that cannot be reached is a dependency outage, not a bug in
    // the request: 503 tells the caller to retry, 500 would tell them not to.
    const databaseUnavailable = isConnectionError(err);
    const status = Number.isInteger(err.status) ? err.status : databaseUnavailable ? 503 : 500;
    const isServerError = status >= 500;

    // An HttpError is a decision this codebase made; anything else is a
    // surprise. Only surprises deserve error level and a stack trace —
    // otherwise a planned 501 would look like a crash in the logs.
    const deliberate = err instanceof HttpError;

    const log = req.log ?? console;
    if (isServerError && !deliberate) {
      log.error('request failed', { err, statusCode: status });
    } else {
      log.warn('request not served', { statusCode: status, code: err.code, reason: err.message });
    }

    res.status(status).json({ error: buildErrorBody({ err, req, status, deliberate, databaseUnavailable }) });
  };
}

function buildErrorBody({ err, req, status, deliberate, databaseUnavailable }) {
  const body = {
    code: resolveCode({ err, status, deliberate, databaseUnavailable }),
    message: resolveMessage({ err, status, deliberate, databaseUnavailable }),
    status,
    requestId: req.id,
    timestamp: new Date().toISOString(),
  };

  // Only our own errors carry details. A driver error's fields describe table
  // and column names, which is internal structure the caller has no business
  // seeing.
  if (deliberate && err.details !== undefined) {
    body.details = err.details;
  }

  return body;
}

function resolveCode({ err, status, deliberate, databaseUnavailable }) {
  if (deliberate) return err.code;
  if (databaseUnavailable) return 'DATABASE_UNAVAILABLE';
  return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
}

function resolveMessage({ err, status, deliberate, databaseUnavailable }) {
  if (databaseUnavailable && !deliberate) {
    // Never the raw driver message: it contains the host, port and user.
    return 'The service is temporarily unable to reach its database';
  }

  // A 5xx message may describe internals, so it is withheld in production
  // unless the error explicitly opted in.
  const exposeMessage = err.expose === true || !config.isProduction;
  return exposeMessage ? err.message : 'Internal Server Error';
}
