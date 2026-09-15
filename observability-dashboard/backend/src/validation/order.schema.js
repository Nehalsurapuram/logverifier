import { z } from 'zod';
import { config } from '../config/index.js';

export const orderIdParams = z.object({
  id: z.uuid({ message: 'must be a valid order id' }),
});

export const orderListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const orderItem = z.object({
  productId: z.uuid({ message: 'must be a valid product id' }),
  quantity: z.number().int().min(1).max(100),
});

export const createOrderSchema = z.object({
  items: z
    .array(orderItem)
    .min(1, 'an order needs at least one item')
    .max(config.commerce.maxOrderItems)
    // The same product twice would violate the (order_id, product_id) unique
    // constraint deep inside the transaction. Catching it here returns a clear
    // 400 instead of a constraint violation the caller cannot act on.
    .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, {
      message: 'each product may appear only once; combine them into one quantity',
    }),
});
