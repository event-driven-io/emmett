import { JSONSerializer } from '../../serialization/json';
import type {
  ActiveSpan,
  LogLevel,
  SpanLink,
  StartSpanOptions,
  TraceContextGenerator,
  Tracer,
} from '../../tracers';
import { logger } from '../../loggers/logger';
import { defaultTraceContextGenerator, noopLogger } from '../../tracers';
import { logEventForSpan } from '../../tracers/spanLogEvent';
import { createConsoleSpanLogSink } from './consoleSpanLogSink';
import type { ConsoleFormat } from './consoleSpanLogger';

export type ConsoleTracerOptions = {
  mode?: ConsoleFormat;
  suppressLogs?: boolean;
  logLevel?: LogLevel;
  traceContextGenerator?: TraceContextGenerator;
};

export const consoleTracer = (options?: ConsoleTracerOptions): Tracer => {
  const mode = options?.mode ?? 'compact';
  const suppressLogs = options?.suppressLogs ?? false;
  const traceContextGenerator =
    options?.traceContextGenerator ?? defaultTraceContextGenerator;
  const sink = createConsoleSpanLogSink(mode);
  const log = suppressLogs
    ? noopLogger
    : logger({
        minLevel: options?.logLevel,
        event: sink,
      });

  return {
    startSpan: async <T>(
      name: string,
      fn: (span: ActiveSpan) => Promise<T>,
      spanOptions?: StartSpanOptions,
    ): Promise<T> => {
      const traceId = traceContextGenerator.generateTraceId();
      const spanId = traceContextGenerator.generateSpanId();
      const context = { traceId, spanId };
      const startMs = Date.now();
      const attributes: Record<string, unknown> = {
        ...spanOptions?.attributes,
      };
      const links: SpanLink[] = [...(spanOptions?.links ?? [])];

      const span: ActiveSpan = {
        spanContext: () => context,
        setAttributes: (attrs) => Object.assign(attributes, attrs),
        addLink: (link) => links.push(link),
        log: (event) => log(logEventForSpan(event, context)),
      };

      let ok = true;
      let spanError: Error | undefined;

      try {
        return await fn(span);
      } catch (e) {
        ok = false;
        spanError = e instanceof Error ? e : new Error(String(e));
        throw e;
      } finally {
        const durationMs = Date.now() - startMs;

        if (mode === 'simple') {
          console.log(
            `[span] ${name} (${durationMs}ms)${ok ? '' : ' [failed]'}`,
          );
        } else {
          const summary = {
            name,
            traceId,
            spanId,
            ...(spanOptions?.parent?.spanId
              ? { parentSpanId: spanOptions.parent.spanId }
              : {}),
            startTimeUnixNano: (BigInt(startMs) * 1_000_000n).toString(),
            endTimeUnixNano: (
              BigInt(startMs + durationMs) * 1_000_000n
            ).toString(),
            attributes,
            status: {
              code: ok ? 'OK' : 'ERROR',
              ...(spanError !== undefined
                ? { message: spanError.message }
                : {}),
            },
            links,
          };

          console.log(
            JSONSerializer.serialize(summary, {
              format: mode === 'pretty' ? 'pretty' : 'compact',
              safe: true,
            }),
          );
        }
      }
    },
  };
};
