import { Router } from 'express';
import { detail, list } from '../controllers/product.controller.js';
import { validate } from '../middleware/validate.js';
import { productIdParams, productListQuery } from '../validation/product.schema.js';

export function createProductRouter() {
  const router = Router();

  // Browsing the catalogue needs no account — that is the point of a catalogue.
  router.get('/', validate({ query: productListQuery }), list);
  router.get('/:id', validate({ params: productIdParams }), detail);

  return router;
}
