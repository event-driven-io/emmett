import type { ActiveSpan, StartSpanOptions, Tracer } from '../tracers';
import type { CollectedSpan } from './collectedSpan';

export type CollectingTracer = Tracer & {
  spans: CollectedSpan[];
};

let nextTraceId = 0;
let nextSpanId = 0;

export const collectingTracer = (): CollectingTracer => {
  const spans: CollectedSpan[] = [];

  return {
    spans,
    startSpan: async <T>(
      name: string,
      fn: (span: ActiveSpan) => Promise<T>,
      options?: StartSpanOptions,
    ): Promise<T> => {
      const traceId = `trace-${++nextTraceId}`;
      const spanId = `span-${++nextSpanId}`;

      const collected: CollectedSpan = {
        name,
        attributes: {},
        events: [],
        links: [],
        exceptions: [],
        startOptions: options ?? {},
        ownContext: { traceId, spanId },
      };
      spans.push(collected);

      const span: ActiveSpan = {
        setAttributes: (attrs) => Object.assign(collected.attributes, attrs),
        spanContext: () => ({ traceId, spanId }),
        addLink: (link) => collected.links.push(link),
        addEvent: (eventName, attributes) =>
          collected.events.push({ name: eventName, attributes }),
        recordException: (error) => collected.exceptions.push(error),
      };

      return fn(span);
    },
  };
};
