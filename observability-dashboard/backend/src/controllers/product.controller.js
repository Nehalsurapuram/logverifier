import { getProductById, listProducts } from '../services/product.service.js';

export async function list(req, res) {
  const { items, pagination } = await listProducts(req.validated.query, req.log);
  res.ok({ items, pagination });
}

export async function detail(req, res) {
  const product = await getProductById(req.validated.params.id, req.log);
  res.ok(product);
}
