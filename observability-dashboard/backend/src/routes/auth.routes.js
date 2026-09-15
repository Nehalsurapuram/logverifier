import { Router } from 'express';
import { login, me, register } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loginSchema, registerSchema } from '../validation/auth.schema.js';

export function createAuthRouter() {
  const router = Router();

  router.post('/register', validate({ body: registerSchema }), register);
  router.post('/login', validate({ body: loginSchema }), login);
  router.get('/me', requireAuth(), me);

  return router;
}
