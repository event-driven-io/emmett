import { shouldLog } from '../loggers/logger';
import type {
  ActiveSpan,
  StartSpanOptions,
  TraceContextGenerator,
  Tracer,
} from '../tracers';
import { defaultTraceContextGenerator } from '../tracers';
import { logEventForSpan } from '../tracers/spanLogEvent';
import type { CollectedSpan } from './collectedSpan';

export type CollectingTracer = Tracer & {
  spans: CollectedSpan[];
};

export type CollectingTracerOptions = {
  traceContextGenerator?: TraceContextGenerator;
};

export const collectingTracer = (
  options?: CollectingTracerOptions,
): CollectingTracer => {
  const spans: CollectedSpan[] = [];
  const traceContextGenerator =
    options?.traceContextGenerator ?? defaultTraceContextGenerator;

  return {
    spans,
    startSpan: async <T>(
      name: string,
      fn: (span: ActiveSpan) => Promise<T>,
      options?: StartSpanOptions,
    ): Promise<T> => {
      const traceId = traceContextGenerator.generateTraceId();
      const spanId = traceContextGenerator.generateSpanId();
      const context = { traceId, spanId };

      const collected: CollectedSpan = {
        name,
        attributes: {},
        logs: [],
        links: [],
        startOptions: options ?? {},
        ownContext: context,
      };
      spans.push(collected);

      const span: ActiveSpan = {
        setAttributes: (attrs) => Object.assign(collected.attributes, attrs),
        spanContext: () => context,
        addLink: (link) => collected.links.push(link),
        log: (event) => {
          if (!shouldLog(event.metadata.level, 'trace')) return;
          collected.logs.push(logEventForSpan(event, context));
        },
      };

      return fn(span);
    },
  };
};
