/**
 * An error that already knows the status code the client should see. Anything
 * else reaching the error handler is treated as an unexpected 500, so internal
 * failures never leak their message by accident.
 */
export class HttpError extends Error {
  constructor(status, message, { code, details, cause, expose } = {}) {
    super(message, { cause });
    this.name = 'HttpError';
    this.status = status;
    this.code = code ?? defaultCode(status);
    this.details = details;
    // Below 500 the message describes the caller's mistake and is safe to send.
    // Above it the message may describe our internals, so it is withheld in
    // production unless a factory below opts in.
    this.expose = expose ?? status < 500;
  }

  static badRequest(message = 'Bad Request', options) {
    return new HttpError(400, message, options);
  }

  static notFound(message = 'Not Found', options) {
    return new HttpError(404, message, options);
  }

  static serviceUnavailable(message = 'Service Unavailable', options) {
    return new HttpError(503, message, options);
  }

  /**
   * A 501 describes a feature that does not exist yet, which is useful to the
   * caller and reveals nothing — so it is shown in production too.
   */
  static notImplemented(message = 'Not Implemented', options) {
    return new HttpError(501, message, { expose: true, ...options });
  }
}

function defaultCode(status) {
  return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
}
