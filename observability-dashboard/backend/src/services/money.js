/**
 * Money crosses the wire as integer cents plus a preformatted string.
 *
 * The number is what a client should compute with; the string is what it should
 * display. Sending only a float would invite the rounding bugs that integer
 * cents exist to prevent.
 */
export function money(amountCents, currency = 'USD') {
  const code = String(currency).trim().toUpperCase();

  return {
    amountCents,
    currency: code,
    formatted: `${(amountCents / 100).toFixed(2)} ${code}`,
  };
}
