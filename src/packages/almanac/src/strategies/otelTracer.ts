import {
  context,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import type { SpanOptions } from '@opentelemetry/api';
import type { ActiveSpan, StartSpanOptions, Tracer } from '../tracer';

export const otelTracer = (tracerName = 'almanac'): Tracer => ({
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
        addEvent: (eventName, attributes) => {
          otelSpan.addEvent(
            eventName,
            attributes as Record<string, string | number | boolean> | undefined,
          );
        },
        recordException: (error) => {
          otelSpan.recordException(
            error instanceof Error ? error : new Error(String(error)),
          );
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
