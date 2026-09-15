import { config } from '../config/index.js';

const LEVEL_WEIGHT = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * One JSON object per line on stdout.
 *
 * That is deliberate and it is the whole Loki extension point: in the
 * log-shipping phase Promtail (or the Docker Loki driver) reads the container's
 * stdout and every field below becomes a queryable label or field. Nothing in
 * this module changes then — only the collector that reads it.
 */
function write(level, message, meta = {}) {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[config.logLevel]) return;

  const record = {
    timestamp: new Date().toISOString(),
    level,
    service: config.serviceName,
    message,
    ...normalize(meta),
  };

  process.stdout.write(`${JSON.stringify(record)}\n`);
}

/** Errors do not survive JSON.stringify, so unpack them into plain fields. */
function normalize(meta) {
  if (!(meta.err instanceof Error)) return meta;

  const { err, ...rest } = meta;
  return {
    ...rest,
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(err.cause ? { cause: String(err.cause) } : {}),
    },
  };
}

function createLogger(bindings = {}) {
  const log = (level) => (message, meta) => write(level, message, { ...bindings, ...meta });

  return {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    /** A logger that stamps every line with the same fields, e.g. a requestId. */
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger = createLogger();
