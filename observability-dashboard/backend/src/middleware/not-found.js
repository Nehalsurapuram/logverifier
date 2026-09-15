import { HttpError } from '../errors/http-error.js';

/** Terminal middleware: nothing matched, so hand a 404 to the error handler. */
export function notFound() {
  return (req, _res, next) => {
    next(HttpError.notFound(`Cannot ${req.method} ${req.path}`, { code: 'ROUTE_NOT_FOUND' }));
  };
}
