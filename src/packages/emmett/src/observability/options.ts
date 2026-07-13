import type {
  Observability,
  ObservabilityScope,
} from '@event-driven-io/almanac';

export type WithObservabilityScope<Context> = Context & {
  observabilityScope: ObservabilityScope;
};

export type PollTracing = 'off' | 'active' | 'verbose';

export type EmmettObservabilityConfig = Partial<Observability<'emmett'>> & {
  pollTracing?: PollTracing;
  includeMessagePayloads?: boolean;
};
