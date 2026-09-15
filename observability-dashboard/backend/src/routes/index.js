import { Router } from 'express';
import { createHealthRouter } from './health.routes.js';
import { createAuthRouter } from './auth.routes.js';
import { createProductRouter } from './product.routes.js';
import { createOrderRouter } from './order.routes.js';
import { createPaymentRouter } from './payment.routes.js';
import { createMetricsRouter } from '../metrics/index.js';
import { createSimulatorRouter } from '../simulator/index.js';

/** Every route the service exposes, mounted in one place. */
export function createRouter() {
  const router = Router();

  // Probes stay outside /api: they answer to orchestrators, not API clients,
  // and keep their bare unwrapped shape.
  mount(router, '/health', createHealthRouter());

  mount(router, '/api/auth', createAuthRouter());
  mount(router, '/api/products', createProductRouter());
  mount(router, '/api/orders', createOrderRouter());
  mount(router, '/api/payments', createPaymentRouter());

  // Declared now, implemented in their own phases. Both answer 501 with a
  // description of what will live there.
  mount(router, '/metrics', createMetricsRouter());
  mount(router, '/api/simulate', createSimulatorRouter());

  return router;
}

/**
 * Records where a router is mounted before handing over to it.
 *
 * Express restores `req.baseUrl` as the stack unwinds, so a router that answers
 * by calling `next(err)` — every 501 seam, and every validation failure — has
 * already lost its mount path by the time the response finishes and the logger
 * runs. Stamping it up front keeps route labels honest on error responses too.
 */
function mount(router, path, handler) {
  router.use(
    path,
    (req, _res, next) => {
      req.mountPath = path;
      next();
    },
    handler,
  );
}
