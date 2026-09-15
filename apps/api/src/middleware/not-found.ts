import type { RequestHandler } from "express";
import { HttpError } from "../http-error.js";

/** Terminal middleware: nothing matched, so hand a 404 to the error handler. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(HttpError.notFound(`Cannot ${req.method} ${req.path}`));
};
