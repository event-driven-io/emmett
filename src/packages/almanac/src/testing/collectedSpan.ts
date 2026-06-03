import type { SpanLink, StartSpanOptions } from '../tracers';
import type { LogEvent } from '../tracers/logger';

export type LoggedEvent = LogEvent;

export type CollectedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  logs: LoggedEvent[];
  links: SpanLink[];
  startOptions: StartSpanOptions;
  ownContext: { traceId: string; spanId: string };
};
