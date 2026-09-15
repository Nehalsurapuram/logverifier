import { HttpError } from '../errors/http-error.js';

/**
 * Validates and coerces the request against zod schemas, then exposes the
 * parsed result as `req.validated`.
 *
 * Nothing downstream reads `req.body`, `req.params` or `req.query` directly, so
 * a handler can never accidentally use an unvalidated value. Parsed output is
 * kept separate rather than assigned back because Express 5 makes `req.query`
 * a getter — writing to it throws.
 *
 * Every failing field is reported at once, so a client fixes one round trip's
 * worth of mistakes instead of discovering them one at a time.
 *
 * @param {{body?: object, params?: object, query?: object}} schemas
 */
export function validate(schemas) {
  return (req, _res, next) => {
    const issues = [];
    const validated = {};

    for (const location of ['params', 'query', 'body']) {
      const schema = schemas[location];
      if (!schema) continue;

      const result = schema.safeParse(req[location]);

      if (result.success) {
        validated[location] = result.data;
        continue;
      }

      for (const issue of result.error.issues) {
        issues.push({
          location,
          field: issue.path.join('.') || '(root)',
          message: issue.message,
        });
      }
    }

    if (issues.length > 0) {
      next(
        HttpError.badRequest('Request validation failed', {
          code: 'VALIDATION_ERROR',
          details: { issues },
        }),
      );
      return;
    }

    req.validated = validated;
    next();
  };
}
