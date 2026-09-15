import { createOrder, getOrderById, listOrders } from '../services/order.service.js';

export async function create(req, res) {
  const order = await createOrder(req.user.id, req.validated.body.items, req.log);
  res.created(order);
}

export async function detail(req, res) {
  const order = await getOrderById(req.user.id, req.validated.params.id, req.log);
  res.ok(order);
}

export async function list(req, res) {
  const { items, pagination } = await listOrders(req.user.id, req.validated.query, req.log);
  res.ok({ items, pagination });
}
