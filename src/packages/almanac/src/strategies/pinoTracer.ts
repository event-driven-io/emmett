import type { Logger as PinoLogger } from 'pino';
import type { ActiveSpan, SpanEventLevel, Tracer } from '../tracer';

export const pinoTracer = (pino: PinoLogger): Tracer => ({
  startSpan: async <T>(
    name: string,
    fn: (span: ActiveSpan) => Promise<T>,
  ): Promise<T> => {
    const startTime = Date.now();
    const attrs: Record<string, unknown> = {};
    const span: ActiveSpan = {
      setAttributes: (a) => Object.assign(attrs, a),
      spanContext: () => ({ traceId: '', spanId: '' }),
      addLink: () => {},
      addEvent: (eventName, eventAttrs, level: SpanEventLevel = 'info') =>
        pino[level]({ ...eventAttrs, spanName: name }, eventName),
      recordException: (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        pino.error({ err: error, spanName: name }, error.message);
      },
    };
    try {
      const result = await fn(span);
      const durationMs = Date.now() - startTime;
      pino.info({ ...attrs, durationMs, status: 'success' }, name);
      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      pino.error({ ...attrs, durationMs, status: 'failure', err }, name);
      throw err;
    }
  },
});
