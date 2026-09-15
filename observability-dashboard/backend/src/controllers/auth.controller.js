import { authenticate, getUserById, issueToken, registerUser } from '../services/auth.service.js';

/** Controllers stay thin: read validated input, call a service, shape the reply. */

export async function register(req, res) {
  const user = await registerUser(req.validated.body, req.log);
  req.log.info('user registered', { userId: user.id });

  // Registering signs you in, so a client does not have to immediately POST
  // the same credentials to /login.
  res.created({ user, ...issueToken(user) });
}

export async function login(req, res) {
  const user = await authenticate(req.validated.body, req.log);
  req.log.info('user logged in', { userId: user.id });

  res.ok({ user, ...issueToken(user) });
}

export async function me(req, res) {
  const user = await getUserById(req.user.id);
  res.ok({ user });
}
