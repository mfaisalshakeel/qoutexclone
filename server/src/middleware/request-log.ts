import crypto from 'node:crypto';
// CJS interop: the module object is callable but typed as a namespace
import { pinoHttp } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { logger } from '../lib/logger.js';

/**
 * HTTP access logging with a request id that also goes out on the response, so
 * a user-reported error can be traced to a single line. Health checks are
 * silenced to keep the log useful.
 */
export const requestLog = pinoHttp({
  logger,
  genReqId(req: IncomingMessage, res: ServerResponse) {
    const existing = req.headers['x-request-id'];
    const id = (Array.isArray(existing) ? existing[0] : existing) || crypto.randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  autoLogging: {
    ignore: (req: IncomingMessage) => req.url === '/api/health' || req.url === '/api/ready',
  },
  customLogLevel(_req: IncomingMessage, res: ServerResponse, error?: Error) {
    if (error || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customProps: (req: IncomingMessage) => ({
    component: 'http',
    userId: (req as IncomingMessage & { user?: { id: string } }).user?.id,
  }),
  serializers: {
    req: (req: IncomingMessage & { id?: string }) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
  },
});
