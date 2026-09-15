import { Router } from 'express';
import { health, ready } from '../controllers/health.controller.js';

export function createHealthRouter() {
  const router = Router();

  router.get('/', health);
  router.get('/ready', ready);

  return router;
}
