import type { ActiveSpan, SpanLink, Tracer } from './tracer';
import type { Counter, Gauge, Histogram, Meter } from './meter';

export type CollectedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  events: { name: string; attributes?: Record<string, unknown> }[];
  links: SpanLink[];
  exceptions: (Error | string)[];
};

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
    ): Promise<T> => {
      const collected: CollectedSpan = {
        name,
        attributes: {},
        events: [],
        links: [],
        exceptions: [],
      };
      spans.push(collected);

      const traceId = `trace-${++nextTraceId}`;
      const spanId = `span-${++nextSpanId}`;

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

export type CollectedCounter = {
  name: string;
  value: number;
  attributes?: Record<string, unknown>;
};
export type CollectedHistogram = {
  name: string;
  value: number;
  attributes?: Record<string, unknown>;
};
export type CollectedGauge = {
  name: string;
  value: number;
  attributes?: Record<string, unknown>;
};

export type CollectingMeter = Meter & {
  counters: CollectedCounter[];
  histograms: CollectedHistogram[];
  gauges: CollectedGauge[];
};

export const collectingMeter = (): CollectingMeter => {
  const counters: CollectedCounter[] = [];
  const histograms: CollectedHistogram[] = [];
  const gauges: CollectedGauge[] = [];

  return {
    counters,
    histograms,
    gauges,
    counter: (name: string): Counter => ({
      add: (value, attributes) => counters.push({ name, value, attributes }),
    }),
    histogram: (name: string): Histogram => ({
      record: (value, attributes) =>
        histograms.push({ name, value, attributes }),
    }),
    gauge: (name: string): Gauge => ({
      record: (value, attributes) => gauges.push({ name, value, attributes }),
    }),
  };
};
