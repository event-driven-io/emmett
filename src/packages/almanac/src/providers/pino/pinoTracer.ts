import type { Logger as PinoLogger } from 'pino';
import type { ActiveSpan, Tracer } from '../../tracers';
import type { RecordMode, SpanRecorder } from '../../tracers/logger';

export const pinoTracer = (
  pino: PinoLogger,
  options?: { mode?: RecordMode },
): Tracer => ({
  startSpan: async <T>(
    name: string,
    fn: (span: ActiveSpan) => Promise<T>,
  ): Promise<T> => {
    const startTime = Date.now();
    const attrs: Record<string, unknown> = {};
    const mode = options?.mode ?? 'logs';

    const makeRecord =
      (level: keyof SpanRecorder) =>
      (msgOrObj: string | Record<string, unknown> | Error, msg?: string) => {
        if (mode === 'span-events') {
          const eventName =
            typeof msgOrObj === 'string' ? msgOrObj : (msg ?? 'event');
          const eventAttrs =
            typeof msgOrObj === 'string'
              ? {}
              : msgOrObj instanceof Error
                ? { err: msgOrObj }
                : msgOrObj;
          pino[level](
            {
              type: 'span-event',
              name: eventName,
              ...eventAttrs,
              spanName: name,
            },
            'span-event',
          );
        } else {
          if (typeof msgOrObj === 'string') {
            pino[level]({ spanName: name }, msgOrObj);
          } else if (msgOrObj instanceof Error) {
            pino[level](
              { err: msgOrObj, spanName: name },
              msg ?? msgOrObj.message,
            );
          } else {
            pino[level]({ ...msgOrObj, spanName: name }, msg);
          }
        }
      };

    const span: ActiveSpan = {
      setAttributes: (a) => Object.assign(attrs, a),
      spanContext: () => ({ traceId: '', spanId: '' }),
      addLink: () => {},
      record: {
        fatal: makeRecord('fatal'),
        error: makeRecord('error'),
        warn: makeRecord('warn'),
        info: makeRecord('info'),
        debug: makeRecord('debug'),
        trace: makeRecord('trace'),
        silent: makeRecord('silent'),
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
