import { context, trace } from '@opentelemetry/api';
import type { RequestHandler } from 'express';

export const traceIdMiddleware: RequestHandler = (_request, response, next) => {
  const traceId = trace.getSpan(context.active())?.spanContext().traceId;
  if (traceId) response.setHeader('x-trace-id', traceId);
  next();
};
