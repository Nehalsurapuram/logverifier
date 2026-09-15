/**
 * Gives every `/api` response the same envelope as an error response, so a
 * client parses one shape either way:
 *
 *   success → { "data": ..., "meta": { "requestId": ..., "timestamp": ... } }
 *   failure → { "error": { "code": ..., "requestId": ..., "timestamp": ... } }
 *
 * The request id appears in the body as well as the `x-request-id` header,
 * because the body is what ends up pasted into a bug report.
 *
 * The health probes deliberately keep their bare shape: they are consumed by
 * orchestrators and uptime checks, not by API clients, and wrapping them would
 * break every tool that already reads `.status`.
 */
export function respond() {
  return (req, res, next) => {
    res.ok = (data, { status = 200, meta } = {}) => {
      res.status(status).json({
        data,
        meta: {
          requestId: req.id,
          timestamp: new Date().toISOString(),
          ...meta,
        },
      });
    };

    res.created = (data, options) => res.ok(data, { ...options, status: 201 });

    next();
  };
}
