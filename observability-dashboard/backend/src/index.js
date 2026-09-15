/**
 * Service entrypoint.
 *
 * Everything below is imported dynamically on purpose. `config` validates the
 * environment at module-evaluation time, and almost every module imports it, so
 * a bad environment throws while the import graph is still being built —
 * before any statement in this file would run. Static imports would make that
 * failure impossible to catch here and print a module-loading stack trace
 * instead of the one-line explanation the operator needs.
 */
async function start() {
  const { config, isUsingInsecureJwtSecret } = await import('./config/index.js');
  const { logger } = await import('./logger/index.js');
  const { createApp } = await import('./app.js');
  const { closePool, startDatabaseHealthMonitor, stopDatabaseHealthMonitor } = await import(
    './database/index.js'
  );

  if (isUsingInsecureJwtSecret() && config.env !== 'test') {
    logger.warn('JWT_SECRET is not set; using the insecure development default', {
      hint: 'Set JWT_SECRET in .env. It is required when NODE_ENV=production.',
    });
  }

  if (config.database.autoMigrate) {
    const { runMigrations } = await import('./database/migrate.js');
    const { applied } = await runMigrations();
    if (applied.length > 0) logger.info('database migrated', { applied });
  }

  // Keeps the cached reading /health serves recent, without /health ever
  // doing I/O of its own.
  startDatabaseHealthMonitor();

  const app = createApp();

  const server = app.listen(config.port, config.host, () => {
    logger.info('service started', {
      url: `http://${config.host}:${config.port}`,
      environment: config.env,
      version: config.version,
    });
  });

  server.on('error', (err) => {
    logger.error('server error', { err });
    process.exitCode = 1;
  });

  installShutdownHandlers({
    server,
    config,
    logger,
    closePool: async () => {
      stopDatabaseHealthMonitor();
      await closePool();
    },
  });
}

/**
 * Stop accepting connections, let in-flight requests drain, close the database
 * pool, then exit. If something outlives the grace period the process leaves
 * anyway — a container stuck in "stopping" is worse than a dropped request.
 */
function installShutdownHandlers({ server, config, logger, closePool }) {
  let shuttingDown = false;

  const shutdown = async (reason, exitCode) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { reason });

    const forceExit = setTimeout(() => {
      logger.error('shutdown timed out, exiting', { timeoutMs: config.shutdownTimeoutMs });
      process.exit(1);
    }, config.shutdownTimeoutMs);
    forceExit.unref();

    try {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        // Keep-alive sockets would otherwise hold the server open until timeout.
        server.closeIdleConnections?.();
      });
      await closePool();
      clearTimeout(forceExit);
      process.exit(exitCode);
    } catch (err) {
      logger.error('error during shutdown', { err });
      process.exit(1);
    }
  };

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => void shutdown(signal, 0));
  }

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection', { err: reason });
    void shutdown('unhandledRejection', 1);
  });

  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception', { err });
    void shutdown('uncaughtException', 1);
  });
}

try {
  await start();
} catch (err) {
  // The logger itself depends on config, so a configuration failure has to
  // report through stderr directly.
  if (err?.name === 'ConfigError') {
    console.error(err.message);
    process.exit(1);
  }
  console.error('Failed to start service:', err);
  process.exit(1);
}
