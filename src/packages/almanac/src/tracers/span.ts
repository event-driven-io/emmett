import type { Logger } from '../loggers/logger';
import { noopLogger } from '../loggers/logger';
import type { TracePropagation } from './tracer';

export type SpanContext = {
  traceId: string;
  spanId: string;
};

export type SpanLink = SpanContext & {
  attributes?: Record<string, unknown>;
};

export type ActiveSpan = {
  setAttributes(attrs: Record<string, unknown>): void;
  spanContext(): SpanContext;
  addLink(link: SpanLink): void;
  log: Logger;
};

export type StartSpanOptions = {
  parent?: SpanContext;
  attributes?: Record<string, unknown>;
  links?: SpanLink[];
  propagation?: TracePropagation;
  sampleRate?: number;
};

export const noopSpan: ActiveSpan = {
  setAttributes: () => {},
  spanContext: () => ({ traceId: '', spanId: '' }),
  addLink: () => {},
  log: noopLogger,
};

const randomHex = (bytes: number): string => {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
};

// OTel-compatible IDs: 128-bit trace (32 hex), 64-bit span (16 hex)
export const generateTraceId = (): string => randomHex(16);
export const generateSpanId = (): string => randomHex(8);
