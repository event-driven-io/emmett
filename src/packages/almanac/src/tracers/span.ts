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
