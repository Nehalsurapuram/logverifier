import type { Server } from "node:http";
import { createApp } from "./app.js";
import { loadConfig, ConfigError } from "./config.js";

function main(): void {
  const config = loadConfig();
  const app = createApp({ exposeInternalErrors: config.NODE_ENV !== "production" });

  const server = app.listen(config.API_PORT, config.API_HOST, () => {
    console.log(
      `[api] listening on http://${config.API_HOST}:${config.API_PORT} (${config.NODE_ENV})`,
    );
  });

  server.on("error", (error) => {
    console.error("[api] server error", error);
    process.exitCode = 1;
  });

  installShutdownHandlers(server, config.SHUTDOWN_TIMEOUT_MS);
}

/**
 * Stop accepting connections, let in-flight requests drain, then exit. If a
 * request outlives the grace period the process leaves anyway — a container
 * stuck in "stopping" is worse than a dropped request.
 */
function installShutdownHandlers(server: Server, timeoutMs: number): void {
  let shuttingDown = false;

  const shutdown = (reason: string, exitCode: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[api] ${reason} received, shutting down`);

    const forceExit = setTimeout(() => {
      console.error(`[api] shutdown timed out after ${timeoutMs}ms, exiting`);
      process.exit(1);
    }, timeoutMs);
    forceExit.unref();

    server.close((error) => {
      clearTimeout(forceExit);
      if (error) {
        console.error("[api] error while closing server", error);
        process.exit(1);
      }
      process.exit(exitCode);
    });

    // Keep-alive sockets would otherwise hold the server open until timeout.
    server.closeIdleConnections?.();
  };

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => shutdown(signal, 0));
  }

  process.on("unhandledRejection", (reason) => {
    console.error("[api] unhandled promise rejection", reason);
    shutdown("unhandledRejection", 1);
  });

  process.on("uncaughtException", (error) => {
    console.error("[api] uncaught exception", error);
    shutdown("uncaughtException", 1);
  });
}

try {
  main();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`[api] ${error.message}`);
    process.exit(1);
  }
  throw error;
}
