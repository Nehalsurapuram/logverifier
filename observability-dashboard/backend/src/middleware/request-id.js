import { randomUUID } from 'node:crypto';
import { logger } from '../logger/index.js';

const HEADER = 'x-request-id';
/** Keep a forwarded id only if it is short and boring — it ends up in logs. */
const SAFE_ID = /^[\w.:-]{1,128}$/;

/**
 * Stamps every request with a correlation id, echoes it back, and hands the
 * handler a logger already bound to it. This is what makes a log line, a metric
 * sample and an HTTP response traceable to each other later.
 */
export function requestId() {
  return (req, res, next) => {
    const forwarded = req.get(HEADER);
    req.id = forwarded && SAFE_ID.test(forwarded) ? forwarded : randomUUID();
    res.setHeader(HEADER, req.id);
    req.log = logger.child({ requestId: req.id });
    next();
  };
}
