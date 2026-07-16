export type TraceContext = {
  traceId?: string;
  spanId?: string;
};

export type ObservabilityContextGenerator = {
  generateTraceId(): string;
  generateSpanId(): string;
  generateMessageId(): string;
  generateCorrelationId(): string;
  generateCausationId(): string;
};

/** @deprecated Use ObservabilityContextGenerator. */
export type TraceContextGenerator = ObservabilityContextGenerator;

const randomHex = (bytes: number): string => {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
};

export const defaultObservabilityContextGenerator: ObservabilityContextGenerator =
  {
    // OTel-compatible IDs: 128-bit trace (32 hex), 64-bit span (16 hex)
    generateTraceId: () => randomHex(16),
    generateSpanId: () => randomHex(8),
    generateMessageId: () => randomHex(16),
    generateCorrelationId: () => randomHex(16),
    generateCausationId: () => randomHex(16),
  };

/** @deprecated Use defaultObservabilityContextGenerator. */
export const defaultTraceContextGenerator =
  defaultObservabilityContextGenerator;
