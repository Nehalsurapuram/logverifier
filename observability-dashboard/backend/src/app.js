import express from 'express';
import { createRouter } from './routes/index.js';
import { requestId } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import { trackInFlight } from './metrics/index.js';
import { respond } from './middleware/respond.js';
import { notFound } from './middleware/not-found.js';
import { errorHandler } from './middleware/error-handler.js';

/**
 * Builds the Express app without binding a port, so tests and `index.js` share
 * one definition of the service.
 *
 * Middleware order matters: the id is assigned before anything can log, the
 * response helpers exist before any route can reply, and the error handler is
 * last so every layer above it can fail into one place.
 */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Behind Docker and any reverse proxy the client ip arrives in X-Forwarded-For.
  app.set('trust proxy', true);

  app.use(requestId());
  // Counted before anything can fail, so the gauge reflects real concurrency.
  app.use(trackInFlight());
  app.use(requestLogger());
  app.use(respond());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.use(createRouter());

  app.use(notFound());
  app.use(errorHandler());

  return app;
}
