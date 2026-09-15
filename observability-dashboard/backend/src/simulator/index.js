import { Router } from 'express';
import { HttpError } from '../errors/http-error.js';

/**
 * Failure-simulator extension point.
 *
 * The simulator exists to give the anomaly detector something to find: it will
 * inject latency, error bursts and load on demand so the AI layer can be tested
 * against known-bad behaviour. Routes are declared here so the surface is
 * visible and documented before it does anything.
 */
export function createSimulatorRouter() {
  const router = Router();

  const planned = {
    'POST /api/simulate/latency': 'add artificial delay to a percentage of requests',
    'POST /api/simulate/errors': 'raise the 5xx rate for a fixed window',
    'POST /api/simulate/load': 'generate synthetic traffic against the sample endpoints',
    'DELETE /api/simulate': 'clear every active simulation',
  };

  router.all(/.*/, (_req, _res, next) => {
    next(
      HttpError.notImplemented('The failure simulator is not implemented yet', {
        code: 'SIMULATOR_NOT_IMPLEMENTED',
        details: { planned },
      }),
    );
  });

  return router;
}
