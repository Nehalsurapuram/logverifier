/**
 * Readiness is "can this instance serve traffic right now" — it depends on the
 * things the service talks to. Phase 2 has no dependencies, so the list is
 * empty and `/readyz` answers immediately; phase 3 registers a PostgreSQL probe
 * here by passing it to `createApp`.
 */
export interface ReadinessCheck {
  readonly name: string;
  /** Resolves when healthy, throws or rejects when not. */
  run(): Promise<void> | void;
}

export interface ReadinessCheckResult {
  readonly name: string;
  readonly status: "pass" | "fail";
  readonly durationMs: number;
  readonly error?: string;
}

export interface ReadinessReport {
  readonly status: "ready" | "not_ready";
  readonly checks: readonly ReadinessCheckResult[];
}

export async function runReadinessChecks(
  checks: readonly ReadinessCheck[],
): Promise<ReadinessReport> {
  const results = await Promise.all(checks.map(runOne));

  return {
    status: results.every((result) => result.status === "pass") ? "ready" : "not_ready",
    checks: results,
  };
}

async function runOne(check: ReadinessCheck): Promise<ReadinessCheckResult> {
  const startedAt = performance.now();

  try {
    await check.run();
    return { name: check.name, status: "pass", durationMs: elapsedSince(startedAt) };
  } catch (error) {
    return {
      name: check.name,
      status: "fail",
      durationMs: elapsedSince(startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
