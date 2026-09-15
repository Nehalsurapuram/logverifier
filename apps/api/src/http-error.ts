/**
 * An error carrying the status code the client should see. Anything else that
 * reaches the error handler is treated as an unexpected 500.
 */
export class HttpError extends Error {
  override readonly name = "HttpError";

  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  static notFound(message = "Not Found", details?: unknown): HttpError {
    return new HttpError(404, message, details);
  }

  static badRequest(message = "Bad Request", details?: unknown): HttpError {
    return new HttpError(400, message, details);
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
