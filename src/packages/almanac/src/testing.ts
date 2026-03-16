import type { Counter, Gauge, Histogram, Meter } from './meter';
import type { ActiveSpan, SpanLink, StartSpanOptions, Tracer } from './tracer';
import type { AttributeTarget, TracePropagation } from './types';

export type CollectedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  events: { name: string; attributes?: Record<string, unknown> }[];
  links: SpanLink[];
  exceptions: (Error | string)[];
  startOptions: StartSpanOptions;
  ownContext: { traceId: string; spanId: string };
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

type SpanAssertions = {
  exists(): SpanAssertions;
  hasAttribute(key: string, value: unknown): SpanAssertions;
  hasAttributes(attrs: Record<string, unknown>): SpanAssertions;
  hasParent(ctx: { traceId: string; spanId: string }): SpanAssertions;
  hasNoParent(): SpanAssertions;
  hasPropagation(p: TracePropagation): SpanAssertions;
  hasCreationLinks(
    links: { traceId: string; spanId: string }[],
  ): SpanAssertions;
};

type SpanCollectionAssertions = {
  haveSpanNamed(name: string): SpanAssertions;
  containSpanNamed(name: string): SpanCollectionAssertions;
  haveNoSpans(): void;
};

export const assertThatSpan = (
  span: CollectedSpan | undefined,
): SpanAssertions => {
  const self: SpanAssertions = {
    exists() {
      if (!span) throw new Error('Expected span to exist but it was not found');
      return self;
    },
    hasAttribute(key, value) {
      if (!span)
        throw new Error(
          `Expected span to have attribute "${key}" but span was not found`,
        );
      const actual = span.attributes[key];
      const isEqual =
        Array.isArray(value) || (typeof value === 'object' && value !== null)
          ? JSON.stringify(actual) === JSON.stringify(value)
          : actual === value;
      if (!isEqual)
        throw new Error(
          `Expected span "${span.name}" attribute "${key}" to be ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`,
        );
      return self;
    },
    hasAttributes(attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        self.hasAttribute(key, value);
      }
      return self;
    },
    hasParent(ctx) {
      if (!span)
        throw new Error('Expected span to have parent but span was not found');
      const parent = span.startOptions.parent;
      if (
        !parent ||
        parent.traceId !== ctx.traceId ||
        parent.spanId !== ctx.spanId
      )
        throw new Error(
          `Expected span "${span.name}" to have parent ${JSON.stringify(ctx)}, got ${JSON.stringify(parent)}`,
        );
      return self;
    },
    hasNoParent() {
      if (!span)
        throw new Error(
          'Expected span to have no parent but span was not found',
        );
      if (span.startOptions.parent)
        throw new Error(
          `Expected span "${span.name}" to have no parent, got ${JSON.stringify(span.startOptions.parent)}`,
        );
      return self;
    },
    hasPropagation(p) {
      if (!span)
        throw new Error(
          `Expected span to have propagation "${p}" but span was not found`,
        );
      if (span.startOptions.propagation !== p)
        throw new Error(
          `Expected span "${span.name}" propagation to be "${p}", got "${span.startOptions.propagation}"`,
        );
      return self;
    },
    hasCreationLinks(links) {
      if (!span)
        throw new Error(
          'Expected span to have creation links but span was not found',
        );
      const actual = span.startOptions.links ?? [];
      for (const expected of links) {
        const found = actual.some(
          (l) => l.traceId === expected.traceId && l.spanId === expected.spanId,
        );
        if (!found)
          throw new Error(
            `Expected span "${span.name}" to have creation link ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
          );
      }
      return self;
    },
  };
  return self;
};

export const assertThatSpans = (
  spans: CollectedSpan[],
): SpanCollectionAssertions => {
  const self: SpanCollectionAssertions = {
    haveSpanNamed(name) {
      const span = spans.find((s) => s.name === name);
      if (!span)
        throw new Error(
          `Expected span named "${name}" but found: [${spans.map((s) => s.name).join(', ')}]`,
        );
      return assertThatSpan(span);
    },
    containSpanNamed(name) {
      const span = spans.find((s) => s.name === name);
      if (!span)
        throw new Error(
          `Expected span named "${name}" but found: [${spans.map((s) => s.name).join(', ')}]`,
        );
      return self;
    },
    haveNoSpans() {
      if (spans.length > 0)
        throw new Error(
          `Expected no spans but found: [${spans.map((s) => s.name).join(', ')}]`,
        );
    },
  };
  return self;
};

export type ObservabilityTestConfig = {
  tracer: CollectingTracer;
  meter: CollectingMeter;
  propagation: TracePropagation;
  attributeTarget: AttributeTarget;
  includeMessagePayloads: boolean;
};

export type TracingSpecification = (given: {
  propagation?: TracePropagation;
  attributeTarget?: AttributeTarget;
}) => {
  when: (fn: (config: ObservabilityTestConfig) => unknown) => {
    then: (
      assertFn: (result: { spans: SpanCollectionAssertions }) => void,
    ) => Promise<void>;
  };
};

export const ObservabilitySpec = {
  for: (): TracingSpecification => {
    return (given) => ({
      when: (fn) => {
        const execute = (() => {
          let cached:
            | { tracer: CollectingTracer; meter: CollectingMeter }
            | undefined;
          return async () => {
            if (!cached) {
              const tracer = collectingTracer();
              const meter = collectingMeter();
              await fn({
                tracer,
                meter,
                propagation: given.propagation ?? 'links',
                attributeTarget: given.attributeTarget ?? 'both',
                includeMessagePayloads: false,
              });
              cached = { tracer, meter };
            }
            return cached;
          };
        })();

        return {
          then: async (assertFn) => {
            const { tracer } = await execute();
            assertFn({ spans: assertThatSpans(tracer.spans) });
          },
        };
      },
    });
  },
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
