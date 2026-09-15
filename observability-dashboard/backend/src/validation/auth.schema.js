import { z } from 'zod';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'must be a valid email address' }));

export const registerSchema = z.object({
  email,
  name: z.string().trim().min(1, 'is required').max(120),
  // Length beats composition rules: a long passphrase is stronger than a short
  // string forced to contain a digit and a symbol.
  password: z.string().min(10, 'must be at least 10 characters').max(200),
});

export const loginSchema = z.object({
  email,
  // No length rule here on purpose — rejecting a short password at the schema
  // would tell an attacker their guess was the wrong shape rather than wrong.
  password: z.string().min(1, 'is required'),
});
