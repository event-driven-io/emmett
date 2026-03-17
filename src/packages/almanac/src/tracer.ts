import type { TracePropagation } from './types';

export type SpanEventLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

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
  addEvent(
    name: string,
    attributes?: Record<string, unknown>,
    level?: SpanEventLevel,
  ): void;
  recordException(error: Error | string): void;
};

export type StartSpanOptions = {
  parent?: SpanContext;
  attributes?: Record<string, unknown>;
  links?: SpanLink[];
  propagation?: TracePropagation;
  sampleRate?: number;
};

export type Tracer = {
  startSpan<T>(
    name: string,
    fn: (span: ActiveSpan) => Promise<T>,
    options?: StartSpanOptions,
  ): Promise<T>;
};

export const noopSpan: ActiveSpan = {
  setAttributes: () => {},
  spanContext: () => ({ traceId: '', spanId: '' }),
  addLink: () => {},
  addEvent: () => {},
  recordException: () => {},
};

export const noopTracer = (): Tracer => ({
  startSpan: async (_name, fn, _options?) => fn(noopSpan),
});
