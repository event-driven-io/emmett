import { context, trace } from '@opentelemetry/api';
import type { onRequestHookHandler } from 'fastify';

export const traceIdHook: onRequestHookHandler = (_request, reply, done) => {
  const traceId = trace.getSpan(context.active())?.spanContext().traceId;
  if (traceId) void reply.header('x-trace-id', traceId);
  done();
};
