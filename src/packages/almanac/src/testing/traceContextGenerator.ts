import type { TraceContextGenerator } from '../tracers';

const values = (value: string | string[]): string[] =>
  Array.isArray(value) ? value : [value];

export const testTraceContextGenerator = (options: {
  traceIds: string | string[];
  spanIds: string | string[];
}): TraceContextGenerator => {
  const traceIds = values(options.traceIds);
  const spanIds = values(options.spanIds);
  let traceIndex = 0;
  let spanIndex = 0;

  return {
    generateTraceId: () => traceIds[traceIndex++] ?? traceIds.at(-1)!,
    generateSpanId: () => spanIds[spanIndex++] ?? spanIds.at(-1)!,
  };
};
