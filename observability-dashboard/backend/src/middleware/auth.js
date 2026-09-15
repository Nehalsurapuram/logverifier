import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { HttpError } from '../errors/http-error.js';

/**
 * Requires a valid `Authorization: Bearer <token>` and puts the caller on
 * `req.user`.
 *
 * The reason a token is rejected is reported precisely — expired vs malformed —
 * because "401" alone sends clients hunting for the wrong problem. What is not
 * reported is anything about which accounts exist.
 */
export function requireAuth() {
  return (req, _res, next) => {
    const header = req.get('authorization');

    if (!header?.startsWith('Bearer ')) {
      next(
        new HttpError(401, 'Missing or malformed Authorization header', {
          code: 'UNAUTHORIZED',
          expose: true,
        }),
      );
      return;
    }

    const token = header.slice('Bearer '.length).trim();

    try {
      const payload = jwt.verify(token, config.auth.jwtSecret);
      req.user = { id: payload.sub, email: payload.email };
      // Bind the caller to this request's logger, so every downstream line says
      // who it was without each call site remembering to pass it.
      req.log = req.log.child({ userId: payload.sub });
      next();
    } catch (err) {
      const expired = err.name === 'TokenExpiredError';
      next(
        new HttpError(401, expired ? 'Token has expired' : 'Token is invalid', {
          code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
          expose: true,
          cause: err,
        }),
      );
    }
  };
}
