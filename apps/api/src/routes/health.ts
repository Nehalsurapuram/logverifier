import { Router } from "express";
import { runReadinessChecks, type ReadinessCheck } from "../health.js";

const startedAt = Date.now();

/**
 * Liveness and readiness, split on purpose:
 *   /healthz — is the process up? Restart the container if this fails.
 *   /readyz  — can it serve? Pull it from the load balancer if this fails.
 */
export function healthRouter(checks: readonly ReadinessCheck[]): Router {
  const router = Router();

  router.get("/healthz", (_req, res) => {
    res.json({
      status: "ok",
      service: "api",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  router.get("/readyz", async (_req, res) => {
    const report = await runReadinessChecks(checks);
    res.status(report.status === "ready" ? 200 : 503).json(report);
  });

  return router;
}
