export type TraceContext = {
  traceId?: string;
  spanId?: string;
};

export type TraceContextGenerator = {
  generateTraceId(): string;
  generateSpanId(): string;
};

const randomHex = (bytes: number): string => {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
};

export const defaultTraceContextGenerator: TraceContextGenerator = {
  // OTel-compatible IDs: 128-bit trace (32 hex), 64-bit span (16 hex)
  generateTraceId: () => randomHex(16),
  generateSpanId: () => randomHex(8),
};
