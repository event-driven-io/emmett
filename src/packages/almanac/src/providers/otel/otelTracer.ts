import type { SpanOptions } from '@opentelemetry/api';
import {
  context,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import type { ActiveSpan, StartSpanOptions, Tracer } from '../../tracers';
import type { RecordMode, SpanRecorder } from '../../tracers/logger';

const severityNumbers: Record<keyof SpanRecorder, SeverityNumber> = {
  fatal: SeverityNumber.FATAL,
  error: SeverityNumber.ERROR,
  warn: SeverityNumber.WARN,
  info: SeverityNumber.INFO,
  debug: SeverityNumber.DEBUG,
  trace: SeverityNumber.TRACE,
  silent: SeverityNumber.UNSPECIFIED,
};

export const otelTracer = (
  tracerName = 'almanac',
  tracerOptions?: { mode?: RecordMode; logger?: SpanRecorder },
): Tracer => ({
  startSpan: async <T>(
    name: string,
    fn: (span: ActiveSpan) => Promise<T>,
    options?: StartSpanOptions,
  ): Promise<T> => {
    const tracer = trace.getTracer(tracerName);
    const spanOptions: SpanOptions = {};

    // Links always added as-is — OTel requires them at creation time.
    if (options?.links?.length) {
      spanOptions.links = options.links.map((l) => ({
        context: { traceId: l.traceId, spanId: l.spanId, traceFlags: 1 },
        attributes: l.attributes as
          | Record<string, string | number | boolean>
          | undefined,
      }));
    }

    // parent handling depends on propagation:
    // 'propagate' → real parent (child span under producer's trace)
    // 'links' → demote parent to a SpanLink, start fresh trace from ROOT_CONTEXT
    // default (no parent) → inherit active context so nested scopes chain naturally
    let ctx =
      options?.propagation === 'links' ? ROOT_CONTEXT : context.active();
    if (options?.parent) {
      const parentCtx = {
        traceId: options.parent.traceId,
        spanId: options.parent.spanId,
        traceFlags: 1,
      };
      if (options.propagation === 'propagate') {
        ctx = trace.setSpanContext(ctx, parentCtx);
      } else {
        spanOptions.links = [
          ...(spanOptions.links ?? []),
          { context: parentCtx },
        ];
      }
    }

    return tracer.startActiveSpan(name, spanOptions, ctx, async (otelSpan) => {
      const mode = tracerOptions?.mode ?? 'span-events';
      const otelLogger = mode === 'logs' ? logs.getLogger(tracerName) : null;

      const makeRecord =
        (level: keyof SpanRecorder) =>
        (msgOrObj: string | Record<string, unknown> | Error, msg?: string) => {
          if (tracerOptions?.logger) {
            if (typeof msgOrObj === 'string') {
              tracerOptions.logger[level](msgOrObj);
            } else {
              tracerOptions.logger[level](msgOrObj, msg);
            }
            return;
          }
          if (mode === 'logs') {
            const body =
              typeof msgOrObj === 'string' ? msgOrObj : (msg ?? 'event');
            const attributes =
              typeof msgOrObj === 'object' && !(msgOrObj instanceof Error)
                ? (msgOrObj as Record<string, string | number | boolean>)
                : {};
            otelLogger!.emit({
              severityNumber: severityNumbers[level],
              severityText: level.toUpperCase(),
              body,
              attributes,
            });
            return;
          }
          if (msgOrObj instanceof Error) {
            otelSpan.recordException(msgOrObj);
            return;
          }
          if (typeof msgOrObj === 'string') {
            otelSpan.addEvent(msgOrObj, { level });
          } else {
            otelSpan.addEvent(msg ?? 'event', {
              level,
              ...(msgOrObj as Record<string, string | number | boolean>),
            });
          }
        };

      const span: ActiveSpan = {
        setAttributes: (attrs) => {
          for (const [key, value] of Object.entries(attrs)) {
            if (value !== undefined) {
              otelSpan.setAttribute(key, value as string | number | boolean);
            }
          }
        },
        spanContext: () => ({
          traceId: otelSpan.spanContext().traceId,
          spanId: otelSpan.spanContext().spanId,
        }),
        addLink: () => {
          // No-op for OTel — links are passed at creation time via SpanOptions.
          // Non-OTel strategies (ClickHouse, Pino) can still accept addLink after creation.
        },
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
        otelSpan.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        otelSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        otelSpan.recordException(
          err instanceof Error ? err : new Error(String(err)),
        );
        throw err;
      } finally {
        otelSpan.end();
      }
    });
  },
});
