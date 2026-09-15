import { Router } from 'express';
import { create, detail, list } from '../controllers/order.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createOrderSchema, orderIdParams, orderListQuery } from '../validation/order.schema.js';

export function createOrderRouter() {
  const router = Router();

  // Every order route is scoped to the caller, so authentication is not
  // optional on any of them.
  router.use(requireAuth());

  router.post('/', validate({ body: createOrderSchema }), create);
  router.get('/', validate({ query: orderListQuery }), list);
  router.get('/:id', validate({ params: orderIdParams }), detail);

  return router;
}
