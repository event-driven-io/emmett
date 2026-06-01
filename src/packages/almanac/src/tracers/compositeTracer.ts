import type { RecordFn } from './logger';
import {
  noopSpan,
  type ActiveSpan,
  type SpanLink,
  type StartSpanOptions,
} from './span';
import type { Tracer } from './tracer';

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

const compositeSpan = (spans: ActiveSpan[]): ActiveSpan => {
  const fan =
    (pick: (s: ActiveSpan) => RecordFn) =>
    (msgOrObj: string | Record<string, unknown> | Error, msg?: string) =>
      spans.forEach((s) => {
        const fn = pick(s);
        if (typeof msgOrObj === 'string') fn(msgOrObj);
        else fn(msgOrObj, msg);
      });

  return {
    setAttributes: (attrs) => spans.forEach((s) => s.setAttributes(attrs)),
    spanContext: () => (spans[0] ?? noopSpan).spanContext(),
    addLink: (link: SpanLink) => spans.forEach((s) => s.addLink(link)),
    record: {
      fatal: fan((s) => s.record.fatal),
      error: fan((s) => s.record.error),
      warn: fan((s) => s.record.warn),
      info: fan((s) => s.record.info),
      debug: fan((s) => s.record.debug),
      trace: fan((s) => s.record.trace),
      silent: fan((s) => s.record.silent),
    },
  };
};
