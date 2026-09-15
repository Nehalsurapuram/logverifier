import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const HEADER = "x-request-id";
/** Keep a forwarded id only if it is short and boring — it ends up in logs. */
const SAFE_ID = /^[\w.:-]{1,128}$/;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id for this request, echoed back in `x-request-id`. */
      id: string;
    }
  }
}

/**
 * Stamps every request with a correlation id. Phase 4 puts this id on each log
 * line, which is what the Grafana Loki datasource's `requestId` derived field
 * keys on to jump from a log line to the rest of the request.
 */
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const forwarded = req.get(HEADER);
    req.id = forwarded && SAFE_ID.test(forwarded) ? forwarded : randomUUID();
    res.setHeader(HEADER, req.id);
    next();
  };
}
