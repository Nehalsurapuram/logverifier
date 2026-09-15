import express, { type Express } from "express";
import type { ReadinessCheck } from "./health.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFound } from "./middleware/not-found.js";
import { requestId } from "./middleware/request-id.js";
import { healthRouter } from "./routes/health.js";

export interface CreateAppOptions {
  /** Dependencies `/readyz` should probe. Empty until phase 3 adds PostgreSQL. */
  readonly readinessChecks?: readonly ReadinessCheck[];
  readonly exposeInternalErrors?: boolean;
}

/**
 * Builds the Express app without binding a port, so tests and `server.ts` share
 * one definition of the service.
 */
export function createApp(options: CreateAppOptions = {}): Express {
  const { readinessChecks = [], exposeInternalErrors = false } = options;
  const app = express();

  app.disable("x-powered-by");
  // Behind Docker/Grafana the client ip arrives in X-Forwarded-For.
  app.set("trust proxy", true);

  app.use(requestId());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));

  app.use(healthRouter(readinessChecks));

  app.use(notFound);
  app.use(errorHandler({ exposeInternalErrors }));

  return app;
}
