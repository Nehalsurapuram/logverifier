import { z } from 'zod';

export const productIdParams = z.object({
  id: z.uuid({ message: 'must be a valid product id' }),
});

export const SORT_OPTIONS = ['newest', 'price_asc', 'price_desc', 'name_asc'];

export const productListQuery = z
  .object({
    // Query strings are always text, so every numeric filter is coerced.
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    category: z.string().trim().min(1).max(60).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    // Prices cross the wire in cents, matching how they are stored.
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    sort: z.enum(SORT_OPTIONS).default('newest'),
  })
  .refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, {
    message: 'minPrice must not be greater than maxPrice',
    path: ['minPrice'],
  });
