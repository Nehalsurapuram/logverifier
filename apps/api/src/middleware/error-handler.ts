import type { ErrorRequestHandler } from "express";
import { isHttpError } from "../http-error.js";

export interface ErrorHandlerOptions {
  /** In production a 500 never leaks the underlying message to the client. */
  readonly exposeInternalErrors: boolean;
}

interface ErrorBody {
  error: { status: number; message: string; requestId: string; details?: unknown };
}

/**
 * The single place an error turns into a response. Express 5 forwards rejected
 * promises from async handlers here on its own, so route code can just throw.
 *
 * Phase 4 replaces the `console.error` below with the structured logger.
 */
export function errorHandler({ exposeInternalErrors }: ErrorHandlerOptions): ErrorRequestHandler {
  return (err, req, res, next) => {
    // Headers already flushed: Express must abort the connection, not re-reply.
    if (res.headersSent) {
      next(err);
      return;
    }

    const status = isHttpError(err) ? err.status : 500;
    const isServerError = status >= 500;

    if (isServerError) {
      console.error(`[api] unhandled error requestId=${req.id}`, err);
    }

    const message =
      isServerError && !exposeInternalErrors
        ? "Internal Server Error"
        : err instanceof Error
          ? err.message
          : String(err);

    const body: ErrorBody = { error: { status, message, requestId: req.id } };

    if (isHttpError(err) && err.details !== undefined) {
      body.error.details = err.details;
    }

    res.status(status).json(body);
  };
}
