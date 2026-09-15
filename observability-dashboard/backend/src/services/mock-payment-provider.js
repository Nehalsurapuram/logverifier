import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { maybeDelay } from '../simulator/delay.js';

/**
 * Stands in for a real payment gateway.
 *
 * Deterministic test card numbers mirror how gateways publish their sandbox
 * cards, which keeps the failure paths testable without a random seed. Every
 * other valid card succeeds, unless PAYMENT_FAILURE_RATE says otherwise.
 */
const TEST_CARDS = new Map([
  ['4000000000000002', { outcome: 'declined', code: 'card_declined', message: 'The card was declined.' }],
  [
    '4000000000009995',
    { outcome: 'declined', code: 'insufficient_funds', message: 'The card has insufficient funds.' },
  ],
  [
    '4000000000000119',
    { outcome: 'error', code: 'processing_error', message: 'The payment provider could not be reached.' },
  ],
]);

export function detectBrand(number) {
  if (/^4/.test(number)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(number)) return 'mastercard';
  if (/^3[47]/.test(number)) return 'amex';
  if (/^(6011|65)/.test(number)) return 'discover';
  return 'unknown';
}

/**
 * @returns {Promise<{outcome: 'succeeded'|'declined'|'error', reference?: string,
 *                    code?: string, message?: string}>}
 */
export async function charge({ amountCents, currency, card }, log) {
  // The only latency in the payment path, and it is off by default.
  await maybeDelay('payments.authorize', log);

  const scripted = TEST_CARDS.get(card.number);
  if (scripted) {
    // Note what is logged: brand and last four only. The full number never
    // reaches a log line, an error message, or the database.
    log?.warn?.('payment provider returned a scripted failure', {
      outcome: scripted.outcome,
      failureCode: scripted.code,
      cardLast4: card.number.slice(-4),
    });
    return { ...scripted };
  }

  if (config.simulation.paymentFailureRate > 0 && Math.random() < config.simulation.paymentFailureRate) {
    return {
      outcome: 'declined',
      code: 'card_declined',
      message: 'The card was declined.',
    };
  }

  return {
    outcome: 'succeeded',
    reference: `ch_${randomUUID().replaceAll('-', '')}`,
    amountCents,
    currency,
  };
}
