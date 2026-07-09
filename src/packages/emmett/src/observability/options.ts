import type {
  AttributeTarget,
  Meter,
  ObservabilityConfig,
  ObservabilityScope,
  TracePropagation,
  Tracer,
} from '@event-driven-io/almanac';
import { noopMeter, noopTracer } from '@event-driven-io/almanac';

export type WithObservabilityScope<Context> = Context & {
  observabilityScope: ObservabilityScope;
};

export type PollTracing = 'off' | 'active' | 'verbose';

export type EmmettObservabilityConfig = ObservabilityConfig<'emmett'> & {
  pollTracing?: PollTracing;
  includeMessagePayloads?: boolean;
};

export type EmmettObservabilityOptions = {
  observability?: EmmettObservabilityConfig;
};

export type ConsumerObservabilityConfig = Pick<
  EmmettObservabilityConfig,
  'tracer' | 'meter' | 'pollTracing' | 'attributeTarget'
>;

export type ProcessorObservabilityConfig = Pick<
  EmmettObservabilityConfig,
  | 'tracer'
  | 'meter'
  | 'propagation'
  | 'attributeTarget'
  | 'includeMessagePayloads'
>;

export type WorkflowObservabilityConfig = ProcessorObservabilityConfig;

export type ResolvedConsumerObservability = {
  tracer: Tracer;
  meter: Meter;
  pollTracing: PollTracing;
  attributeTarget: AttributeTarget;
};

export type ResolvedWorkflowObservability = {
  tracer: Tracer;
  meter: Meter;
  propagation: TracePropagation;
  attributeTarget: AttributeTarget;
  includeMessagePayloads: boolean;
};

export const mergeObservabilityOptions = <
  Config extends Partial<EmmettObservabilityConfig>,
  Options extends { observability?: Config },
>(
  options: Options,
  defaults: Partial<EmmettObservabilityConfig> | undefined,
): Options => {
  const observability =
    defaults === undefined
      ? options.observability
      : options.observability === undefined
        ? defaults
        : { ...defaults, ...options.observability };
  if (observability === options.observability) return options;

  return {
    ...options,
    observability,
  };
};

export const consumerObservability = (
  options: { observability?: ConsumerObservabilityConfig } | undefined,
  parent?: EmmettObservabilityOptions,
): ResolvedConsumerObservability => {
  const observability = mergeObservabilityOptions(
    { observability: options?.observability },
    parent?.observability,
  ).observability;

  return {
    tracer: observability?.tracer ?? noopTracer(),
    meter: observability?.meter ?? noopMeter(),
    pollTracing: observability?.pollTracing ?? 'off',
    attributeTarget: observability?.attributeTarget ?? 'both',
  };
};

export const workflowObservability = (
  options: { observability?: WorkflowObservabilityConfig } | undefined,
  parent?: EmmettObservabilityOptions,
): ResolvedWorkflowObservability => {
  const observability = mergeObservabilityOptions(
    { observability: options?.observability },
    parent?.observability,
  ).observability;

  return {
    tracer: observability?.tracer ?? noopTracer(),
    meter: observability?.meter ?? noopMeter(),
    propagation: observability?.propagation ?? 'links',
    attributeTarget: observability?.attributeTarget ?? 'both',
    includeMessagePayloads: observability?.includeMessagePayloads ?? false,
  };
};
