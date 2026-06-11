import type { LogEvent } from '../loggers/logger';
import type { SpanLink, StartSpanOptions } from '../tracers';

export type LoggedEvent = LogEvent;

export type CollectedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  logs: LoggedEvent[];
  links: SpanLink[];
  startOptions: StartSpanOptions;
  ownContext: { traceId: string; spanId: string };
};
