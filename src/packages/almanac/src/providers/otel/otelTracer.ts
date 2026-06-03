import type { SpanOptions } from '@opentelemetry/api';
import {
  context,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import type { AnyValueMap } from '@opentelemetry/api-logs';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import type { ActiveSpan, StartSpanOptions, Tracer } from '../../tracers';
import type { LogEvent, Logger, RecordLevel } from '../../tracers/logger';
import { logEvent, logger } from '../../tracers/logger';

const severityNumbers: Record<RecordLevel, SeverityNumber> = {
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
  tracerOptions?: { logger?: Logger; minLevel?: RecordLevel },
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
      const otelLogger = logs.getLogger(tracerName);

      const emit = (e: LogEvent): void => {
        const attributes: AnyValueMap = { ...(e.attributes as AnyValueMap) };
        if (e.error) {
          attributes['exception.type'] = e.error.name;
          attributes['exception.message'] = e.error.message;
          if (e.error.stack) attributes['exception.stacktrace'] = e.error.stack;
        }
        otelLogger.emit({
          timestamp: e.timestamp,
          severityNumber: severityNumbers[e.level],
          severityText: e.severityText,
          ...(e.body !== undefined ? { body: e.body } : {}),
          ...(e.eventName !== undefined ? { eventName: e.eventName } : {}),
          attributes,
        });
      };

      const record: Logger =
        tracerOptions?.logger ??
        logger({ event: emit, minLevel: tracerOptions?.minLevel });

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
        record,
      };
      try {
        const result = await fn(span);
        otelSpan.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        otelSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
        emit(logEvent('error', { eventName: 'exception', error }));
        throw err;
      } finally {
        otelSpan.end();
      }
    });
  },
});
