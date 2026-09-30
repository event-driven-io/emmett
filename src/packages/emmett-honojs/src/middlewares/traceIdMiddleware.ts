import { context, trace } from '@opentelemetry/api';
import type { MiddlewareHandler } from 'hono';

export const traceIdMiddleware: MiddlewareHandler = async (c, next) => {
  const traceId = trace.getSpan(context.active())?.spanContext().traceId;
  if (traceId) c.header('x-trace-id', traceId);
  await next();
};
