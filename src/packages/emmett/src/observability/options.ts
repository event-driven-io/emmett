import type {
  Tracer,
  Meter,
  TracePropagation,
  AttributeTarget,
  ObservabilityConfig,
} from '@event-driven-io/almanac';
import { noopTracer, noopMeter } from '@event-driven-io/almanac';

export type PollTracing = 'off' | 'active' | 'verbose';

export type EmmettObservabilityConfig = ObservabilityConfig<'emmett'> & {
  pollTracing?: PollTracing;
  includeMessagePayloads?: boolean;
};

export type EmmettObservabilityOptions = {
  observability?: EmmettObservabilityConfig;
};

export type CommandObservabilityConfig = Pick<
  EmmettObservabilityConfig,
  'tracer' | 'meter' | 'attributeTarget' | 'includeMessagePayloads'
>;

export type ProcessorObservabilityConfig = Pick<
  EmmettObservabilityConfig,
  | 'tracer'
  | 'meter'
  | 'propagation'
  | 'attributeTarget'
  | 'includeMessagePayloads'
>;

export type ConsumerObservabilityConfig = Pick<
  EmmettObservabilityConfig,
  'tracer' | 'meter' | 'pollTracing' | 'attributeTarget'
>;

export type EventStoreObservabilityConfig = Pick<
  EmmettObservabilityConfig,
  'tracer' | 'meter' | 'attributeTarget'
>;

export type WorkflowObservabilityConfig = Pick<
  EmmettObservabilityConfig,
  | 'tracer'
  | 'meter'
  | 'propagation'
  | 'attributeTarget'
  | 'includeMessagePayloads'
>;

export type ResolvedCommandObservability = {
  tracer: Tracer;
  meter: Meter;
  attributeTarget: AttributeTarget;
  includeMessagePayloads: boolean;
};

export type ResolvedProcessorObservability = {
  tracer: Tracer;
  meter: Meter;
  propagation: TracePropagation;
  attributeTarget: AttributeTarget;
  includeMessagePayloads: boolean;
};

export type ResolvedConsumerObservability = {
  tracer: Tracer;
  meter: Meter;
  pollTracing: PollTracing;
  attributeTarget: AttributeTarget;
};

export type ResolvedEventStoreObservability = {
  tracer: Tracer;
  meter: Meter;
  attributeTarget: AttributeTarget;
};

export type ResolvedWorkflowObservability = {
  tracer: Tracer;
  meter: Meter;
  propagation: TracePropagation;
  attributeTarget: AttributeTarget;
  includeMessagePayloads: boolean;
};

export const resolveCommandObservability = (
  options: { observability?: CommandObservabilityConfig } | undefined,
  parent?: EmmettObservabilityOptions,
): ResolvedCommandObservability => ({
  tracer:
    options?.observability?.tracer ??
    parent?.observability?.tracer ??
    noopTracer(),
  meter:
    options?.observability?.meter ??
    parent?.observability?.meter ??
    noopMeter(),
  attributeTarget:
    options?.observability?.attributeTarget ??
    parent?.observability?.attributeTarget ??
    'both',
  includeMessagePayloads:
    options?.observability?.includeMessagePayloads ??
    parent?.observability?.includeMessagePayloads ??
    false,
});

export const resolveProcessorObservability = (
  options: { observability?: ProcessorObservabilityConfig } | undefined,
  parent?: EmmettObservabilityOptions,
): ResolvedProcessorObservability => ({
  tracer:
    options?.observability?.tracer ??
    parent?.observability?.tracer ??
    noopTracer(),
  meter:
    options?.observability?.meter ??
    parent?.observability?.meter ??
    noopMeter(),
  propagation:
    options?.observability?.propagation ??
    parent?.observability?.propagation ??
    'links',
  attributeTarget:
    options?.observability?.attributeTarget ??
    parent?.observability?.attributeTarget ??
    'both',
  includeMessagePayloads:
    options?.observability?.includeMessagePayloads ??
    parent?.observability?.includeMessagePayloads ??
    false,
});

export const resolveConsumerObservability = (
  options: { observability?: ConsumerObservabilityConfig } | undefined,
  parent?: EmmettObservabilityOptions,
): ResolvedConsumerObservability => ({
  tracer:
    options?.observability?.tracer ??
    parent?.observability?.tracer ??
    noopTracer(),
  meter:
    options?.observability?.meter ??
    parent?.observability?.meter ??
    noopMeter(),
  pollTracing:
    options?.observability?.pollTracing ??
    parent?.observability?.pollTracing ??
    'off',
  attributeTarget:
    options?.observability?.attributeTarget ??
    parent?.observability?.attributeTarget ??
    'both',
});

export const resolveEventStoreObservability = (
  options: { observability?: EventStoreObservabilityConfig } | undefined,
  parent?: EmmettObservabilityOptions,
): ResolvedEventStoreObservability => ({
  tracer:
    options?.observability?.tracer ??
    parent?.observability?.tracer ??
    noopTracer(),
  meter:
    options?.observability?.meter ??
    parent?.observability?.meter ??
    noopMeter(),
  attributeTarget:
    options?.observability?.attributeTarget ??
    parent?.observability?.attributeTarget ??
    'both',
});

export const resolveWorkflowObservability = (
  options: { observability?: WorkflowObservabilityConfig } | undefined,
  parent?: EmmettObservabilityOptions,
): ResolvedWorkflowObservability => ({
  tracer:
    options?.observability?.tracer ??
    parent?.observability?.tracer ??
    noopTracer(),
  meter:
    options?.observability?.meter ??
    parent?.observability?.meter ??
    noopMeter(),
  propagation:
    options?.observability?.propagation ??
    parent?.observability?.propagation ??
    'links',
  attributeTarget:
    options?.observability?.attributeTarget ??
    parent?.observability?.attributeTarget ??
    'both',
  includeMessagePayloads:
    options?.observability?.includeMessagePayloads ??
    parent?.observability?.includeMessagePayloads ??
    false,
});
