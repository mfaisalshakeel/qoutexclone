import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = 'error',
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string, code = 'bad_request', details?: unknown) =>
  new AppError(400, msg, code, details);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, msg, 'unauthorized');
export const forbidden = (msg = 'Not allowed', code = 'forbidden') => new AppError(403, msg, code);
export const notFound = (msg = 'Not found') => new AppError(404, msg, 'not_found');
export const conflict = (msg: string, code = 'conflict', details?: unknown) =>
  new AppError(409, msg, code, details);

/** Wraps an async route handler so rejected promises reach the error middleware. */
export function wrap(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
