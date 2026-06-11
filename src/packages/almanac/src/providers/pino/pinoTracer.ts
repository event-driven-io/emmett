import type { Logger as PinoLogger } from 'pino';
import { logger } from '../../loggers/logger';
import type { ActiveSpan, Tracer } from '../../tracers';

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
      log: logger({
        minLevel: 'trace',
        event: (event) =>
          pino[event.level](
            {
              ...(event.attributes ?? {}),
              ...(event.eventName ? { eventName: event.eventName } : {}),
              ...(event.error ? { err: event.error } : {}),
              spanName: name,
            },
            event.body ?? event.error?.message,
          ),
      }),
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
