import { recordHttpRequest } from '../metrics/index.js';

/**
 * Logs one log line per completed request and feeds the same event to the
 * metrics seam, so Prometheus and Loki end up describing identical requests.
 */
export function requestLogger() {
  return (req, res, next) => {
    const startedAt = performance.now();

    res.on('finish', () => {
      const durationMs = Math.round(performance.now() - startedAt);
      const route = resolveRoute(req);

      req.log.info('request completed', {
        method: req.method,
        path: req.originalUrl,
        route,
        statusCode: res.statusCode,
        durationMs,
      });

      recordHttpRequest({
        method: req.method,
        // Unmatched requests collapse to one label value on purpose: a route
        // label fed from raw paths is the classic way to explode Prometheus
        // cardinality, since any caller can invent new ones.
        route: route ?? '(unmatched)',
        statusCode: res.statusCode,
        durationMs,
      });
    });

    next();
  };
}

/**
 * The route *pattern* that served this request — `/health/ready`, never
 * `/health/ready?x=1`. `req.route.path` is relative to its router, so the mount
 * path recorded in routes/index.js has to be added back.
 */
function resolveRoute(req) {
  const base = req.mountPath ?? req.baseUrl ?? '';
  const routePath = req.route?.path;

  // A router matching on a regex (the simulator) has no meaningful sub-path;
  // the mount point alone is the useful, bounded label.
  if (typeof routePath !== 'string') return base || null;

  const combined = `${base}${routePath}`;
  return combined.length > 1 ? combined.replace(/\/$/, '') : '/';
}
