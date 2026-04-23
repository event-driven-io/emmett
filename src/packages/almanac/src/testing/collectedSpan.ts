import type { SpanLink, StartSpanOptions } from '../tracers';

export type CollectedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  events: { name: string; attributes?: Record<string, unknown> }[];
  links: SpanLink[];
  exceptions: (Error | string)[];
  startOptions: StartSpanOptions;
  ownContext: { traceId: string; spanId: string };
};
