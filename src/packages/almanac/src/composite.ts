import type { ActiveSpan, SpanLink, StartSpanOptions, Tracer } from './tracer';
import { noopSpan } from './tracer';
import type { Counter, Gauge, Histogram, Meter } from './meter';

const compositeSpan = (spans: ActiveSpan[]): ActiveSpan => ({
  setAttributes: (attrs) => spans.forEach((s) => s.setAttributes(attrs)),
  spanContext: () => (spans[0] ?? noopSpan).spanContext(),
  addLink: (link: SpanLink) => spans.forEach((s) => s.addLink(link)),
  addEvent: (name, attributes) =>
    spans.forEach((s) => s.addEvent(name, attributes)),
  recordException: (error) => spans.forEach((s) => s.recordException(error)),
});

export const compositeTracer = (...tracers: Tracer[]): Tracer => ({
  startSpan: async <T>(
    name: string,
    fn: (span: ActiveSpan) => Promise<T>,
    options?: StartSpanOptions,
  ): Promise<T> => {
    if (tracers.length === 0) return fn(noopSpan);

    const nest = (index: number, collectedSpans: ActiveSpan[]): Promise<T> => {
      if (index >= tracers.length) {
        return fn(compositeSpan(collectedSpans));
      }
      return tracers[index]!.startSpan(
        name,
        async (span) => nest(index + 1, [...collectedSpans, span]),
        options,
      );
    };

    return nest(0, []);
  },
});

export const compositeMeter = (...meters: Meter[]): Meter => ({
  counter: (name: string): Counter => ({
    add: (value, attributes) =>
      meters.forEach((m) => m.counter(name).add(value, attributes)),
  }),
  histogram: (name: string): Histogram => ({
    record: (value, attributes) =>
      meters.forEach((m) => m.histogram(name).record(value, attributes)),
  }),
  gauge: (name: string): Gauge => ({
    record: (value, attributes) =>
      meters.forEach((m) => m.gauge(name).record(value, attributes)),
  }),
});
