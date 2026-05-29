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

export type WorkflowObservabilityConfig = Pick<
  EmmettObservabilityConfig,
  | 'tracer'
  | 'meter'
  | 'propagation'
  | 'attributeTarget'
  | 'includeMessagePayloads'
>;

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
