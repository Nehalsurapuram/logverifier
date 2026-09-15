import { setTimeout as sleep } from 'node:timers/promises';
import { config } from '../config/index.js';
import { recordSimulatedDelay } from '../metrics/index.js';

/**
 * The single source of artificial latency in this service.
 *
 * No `sleep` is hard-coded anywhere in the request path — every simulated delay
 * goes through here and is off unless `SIMULATED_DELAY_ENABLED=true`. That
 * keeps a demo knob from quietly becoming production behaviour, and it means
 * one environment variable makes the whole system slow on command when the
 * observability stack needs something to detect.
 *
 * @param {string} operation Name recorded in the log line, e.g. 'orders.create'.
 * @param {object} [log]     Request-scoped logger; falls back to silence.
 * @returns {Promise<number>} Milliseconds actually waited.
 */
export async function maybeDelay(operation, log) {
  const { delayEnabled, delayMinMs, delayMaxMs } = config.simulation;

  if (!delayEnabled || delayMaxMs <= 0) return 0;

  const spread = delayMaxMs - delayMinMs;
  const delayMs = spread <= 0 ? delayMinMs : delayMinMs + Math.floor(Math.random() * (spread + 1));

  if (delayMs <= 0) return 0;

  await sleep(delayMs);
  log?.debug?.('simulated delay applied', { operation, delayMs });
  // Counted separately so injected latency can be told apart from real
  // slowness when reading a latency graph.
  recordSimulatedDelay({ operation, delayMs });

  return delayMs;
}
