import { JSONSerializer } from '../../serialization/json';
import type {
  ActiveSpan,
  RecordLevel,
  StartSpanOptions,
  Tracer,
} from '../../tracers';
import { generateSpanId, generateTraceId, noopRecorder } from '../../tracers';
import { consoleSpanRecorder, type ConsoleFormat } from './consoleSpanRecorder';

export type ConsoleTracerOptions = {
  mode?: ConsoleFormat;
  suppressRecords?: boolean;
  recordLevel?: RecordLevel;
};

export const consoleTracer = (options?: ConsoleTracerOptions): Tracer => {
  const mode = options?.mode ?? 'compact';
  const suppressRecords = options?.suppressRecords ?? false;

  return {
    startSpan: async <T>(
      name: string,
      fn: (span: ActiveSpan) => Promise<T>,
      _spanOptions?: StartSpanOptions,
    ): Promise<T> => {
      const traceId = generateTraceId();
      const spanId = generateSpanId();
      const startMs = Date.now();
      const attributes: Record<string, unknown> = {};

      const span: ActiveSpan = {
        spanContext: () => ({ traceId, spanId }),
        setAttributes: (attrs) => Object.assign(attributes, attrs),
        addLink: () => {},
        record: !suppressRecords
          ? consoleSpanRecorder({
              format: mode,
              recordLevel: options?.recordLevel,
            })
          : noopRecorder,
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
        const summary: Record<string, unknown> = {
          span: name,
          traceId,
          spanId,
          durationMs,
          ok,
        };
        if (spanError !== undefined) summary.error = spanError;

        if (mode === 'simple') {
          console.log(
            `[span] ${name} (${durationMs}ms)${ok ? '' : ' [failed]'}`,
          );
        } else {
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
