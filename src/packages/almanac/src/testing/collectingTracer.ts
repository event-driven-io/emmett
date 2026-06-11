import { logger } from '../loggers/logger';
import type { ActiveSpan, StartSpanOptions, Tracer } from '../tracers';
import { generateSpanId, generateTraceId } from '../tracers';
import type { CollectedSpan } from './collectedSpan';

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
        logs: [],
        links: [],
        startOptions: options ?? {},
        ownContext: { traceId, spanId },
      };
      spans.push(collected);

      const span: ActiveSpan = {
        setAttributes: (attrs) => Object.assign(collected.attributes, attrs),
        spanContext: () => ({ traceId, spanId }),
        addLink: (link) => collected.links.push(link),
        log: logger({
          minLevel: 'trace',
          event: (e) => collected.logs.push(e),
        }),
      };

      return fn(span);
    },
  };
};
