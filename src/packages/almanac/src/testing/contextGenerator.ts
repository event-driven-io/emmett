import type { ObservabilityContextGenerator } from '../tracers';

const values = (value: string | string[]): string[] =>
  Array.isArray(value) ? value : [value];

export const testObservabilityContextGenerator = (options: {
  traceIds: string | string[];
  spanIds: string | string[];
  messageIds?: string | string[];
  correlationIds?: string | string[];
  causationIds?: string | string[];
}): ObservabilityContextGenerator => {
  const traceIds = values(options.traceIds);
  const spanIds = values(options.spanIds);
  const messageIds = values(options.messageIds ?? 'message-id');
  const correlationIds = values(options.correlationIds ?? 'correlation-id');
  const causationIds = values(options.causationIds ?? 'causation-id');
  let traceIndex = 0;
  let spanIndex = 0;
  let messageIndex = 0;
  let correlationIndex = 0;
  let causationIndex = 0;

  return {
    generateTraceId: () => traceIds[traceIndex++] ?? traceIds.at(-1)!,
    generateSpanId: () => spanIds[spanIndex++] ?? spanIds.at(-1)!,
    generateMessageId: () => messageIds[messageIndex++] ?? messageIds.at(-1)!,
    generateCorrelationId: () =>
      correlationIds[correlationIndex++] ?? correlationIds.at(-1)!,
    generateCausationId: () =>
      causationIds[causationIndex++] ?? causationIds.at(-1)!,
  };
};
