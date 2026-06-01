import type { ActiveSpan, StartSpanOptions, Tracer } from '../tracers';
import { generateSpanId, generateTraceId } from '../tracers';
import type { CollectedSpan, RecordedEntry } from './collectedSpan';

export type CollectingTracer = Tracer & {
  spans: CollectedSpan[];
};

export const collectingTracer = (): CollectingTracer => {
  const spans: CollectedSpan[] = [];

  return {
    spans,
    startSpan: async <T>(
      name: string,
      fn: (span: ActiveSpan) => Promise<T>,
      options?: StartSpanOptions,
    ): Promise<T> => {
      const traceId = generateTraceId();
      const spanId = generateSpanId();

      const collected: CollectedSpan = {
        name,
        attributes: {},
        records: [],
        links: [],
        startOptions: options ?? {},
        ownContext: { traceId, spanId },
      };
      spans.push(collected);

      const makeRecordFn =
        (level: RecordedEntry['level']) =>
        (msgOrObj: string | Record<string, unknown> | Error, msg?: string) => {
          if (typeof msgOrObj === 'string') {
            collected.records.push({ level, msg: msgOrObj });
          } else {
            collected.records.push({ level, obj: msgOrObj, msg });
          }
        };

      const span: ActiveSpan = {
        setAttributes: (attrs) => Object.assign(collected.attributes, attrs),
        spanContext: () => ({ traceId, spanId }),
        addLink: (link) => collected.links.push(link),
        record: {
          fatal: makeRecordFn('fatal'),
          error: makeRecordFn('error'),
          warn: makeRecordFn('warn'),
          info: makeRecordFn('info'),
          debug: makeRecordFn('debug'),
          trace: makeRecordFn('trace'),
          silent: makeRecordFn('silent'),
        },
      };

      return fn(span);
    },
  };
};
