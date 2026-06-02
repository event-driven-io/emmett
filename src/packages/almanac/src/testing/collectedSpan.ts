import type { RecordLevel, SpanLink, StartSpanOptions } from '../tracers';

export type RecordedEntry = {
  level: RecordLevel;
  msg?: string;
  obj?: Record<string, unknown> | Error;
};

export type CollectedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  records: RecordedEntry[];
  links: SpanLink[];
  startOptions: StartSpanOptions;
  ownContext: { traceId: string; spanId: string };
};
