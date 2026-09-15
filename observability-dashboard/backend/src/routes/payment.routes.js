import { Router } from 'express';
import { pay } from '../controllers/payment.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createPaymentSchema } from '../validation/payment.schema.js';

export function createPaymentRouter() {
  const router = Router();

  router.use(requireAuth());
  router.post('/', validate({ body: createPaymentSchema }), pay);

  return router;
}
