import { z } from 'zod';

/**
 * Luhn checksum — the same check a real gateway runs before it bothers to
 * charge anything. Rejecting a mistyped number here saves a network round trip
 * and produces a far clearer error than a provider decline.
 */
export function passesLuhn(digits) {
  let sum = 0;
  let double = false;

  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }

  return sum % 10 === 0;
}

const card = z
  .object({
    number: z
      .string()
      .trim()
      // Accept the spaces and dashes people actually type, then normalise.
      .transform((value) => value.replace(/[\s-]/g, ''))
      .pipe(
        z
          .string()
          .regex(/^\d{13,19}$/, 'must be 13 to 19 digits')
          .refine(passesLuhn, 'failed the card number checksum'),
      ),
    expiryMonth: z.number().int().min(1).max(12),
    expiryYear: z.number().int().min(2000).max(2100),
    cvc: z.string().trim().regex(/^\d{3,4}$/, 'must be 3 or 4 digits'),
    holderName: z.string().trim().min(1).max(120),
  })
  .refine(
    (c) => {
      const now = new Date();
      // A card is valid through the last day of its expiry month.
      const expiry = new Date(Date.UTC(c.expiryYear, c.expiryMonth, 1));
      return expiry > now;
    },
    { message: 'card has expired', path: ['expiryMonth'] },
  );

export const createPaymentSchema = z.object({
  orderId: z.uuid({ message: 'must be a valid order id' }),
  card,
});

export const paymentIdParams = z.object({
  id: z.uuid({ message: 'must be a valid payment id' }),
});
