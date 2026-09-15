import { z } from "zod";

/**
 * Environment contract for the api service.
 *
 * Values come from the repo-root `.env` (see `.env.example`); every key has a
 * default so the service boots in a bare checkout. Later phases extend this
 * schema rather than reading `process.env` directly — one place to look when a
 * deployment misbehaves.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** How long in-flight requests get to finish after SIGTERM/SIGINT. */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Config = Readonly<z.infer<typeof envSchema>>;

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`Invalid environment configuration:\n${issues}`);
  }

  return Object.freeze(parsed.data);
}
