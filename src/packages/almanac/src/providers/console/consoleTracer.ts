import { JSONSerializer } from '../../serialization/json';
import type {
  ActiveSpan,
  LogLevel,
  SpanLink,
  StartSpanOptions,
  Tracer,
} from '../../tracers';
import { generateSpanId, generateTraceId, noopLogger } from '../../tracers';
import { consoleSpanLogger, type ConsoleFormat } from './consoleSpanLogger';

export type ConsoleTracerOptions = {
  mode?: ConsoleFormat;
  suppressRecords?: boolean;
  recordLevel?: LogLevel;
};

export const consoleTracer = (options?: ConsoleTracerOptions): Tracer => {
  const mode = options?.mode ?? 'compact';
  const suppressRecords = options?.suppressRecords ?? false;

  return {
    startSpan: async <T>(
      name: string,
      fn: (span: ActiveSpan) => Promise<T>,
      spanOptions?: StartSpanOptions,
    ): Promise<T> => {
      const traceId = generateTraceId();
      const spanId = generateSpanId();
      const startMs = Date.now();
      const attributes: Record<string, unknown> = {
        ...spanOptions?.attributes,
      };
      const links: SpanLink[] = [...(spanOptions?.links ?? [])];

      const span: ActiveSpan = {
        spanContext: () => ({ traceId, spanId }),
        setAttributes: (attrs) => Object.assign(attributes, attrs),
        addLink: (link) => links.push(link),
        log: !suppressRecords
          ? consoleSpanLogger({
              format: mode,
              recordLevel: options?.recordLevel,
              traceId,
              spanId,
            })
          : noopLogger,
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
