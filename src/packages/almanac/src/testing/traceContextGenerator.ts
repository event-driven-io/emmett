import type { TraceContextGenerator } from '../tracers';

const values = (value: string | string[]): string[] =>
  Array.isArray(value) ? value : [value];

export type TestTraceContextGenerator = TraceContextGenerator & {
  generateCorrelationId: () => string;
  generateCausationId: () => string;
};

export const testTraceContextGenerator = (options: {
  traceIds: string | string[];
  spanIds: string | string[];
  correlationIds?: string | string[];
  causationIds?: string | string[];
}): TestTraceContextGenerator => {
  const traceIds = values(options.traceIds);
  const spanIds = values(options.spanIds);
  const correlationIds = values(options.correlationIds ?? 'correlation-id');
  const causationIds = values(options.causationIds ?? 'causation-id');
  let traceIndex = 0;
  let spanIndex = 0;
  let correlationIndex = 0;
  let causationIndex = 0;

  return {
    generateTraceId: () => traceIds[traceIndex++] ?? traceIds.at(-1)!,
    generateSpanId: () => spanIds[spanIndex++] ?? spanIds.at(-1)!,
    generateCorrelationId: () =>
      correlationIds[correlationIndex++] ?? correlationIds.at(-1)!,
    generateCausationId: () =>
      causationIds[causationIndex++] ?? causationIds.at(-1)!,
  };
};
