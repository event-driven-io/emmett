import type { Logger as PinoLogger } from 'pino';
import { shouldLog } from '../../loggers/logger';
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
      log: (event) => {
        if (
          event.metadata.level === 'silent' ||
          !shouldLog(event.metadata.level, 'trace')
        )
          return;

        pino[event.metadata.level](
          {
            ...(event.data.attributes ?? {}),
            ...(event.name ? { eventName: event.name } : {}),
            ...(event.data.error ? { err: event.data.error } : {}),
            spanName: name,
          },
          event.data.body ?? event.data.error?.message,
        );
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
