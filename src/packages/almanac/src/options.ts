import type { Tracer } from './tracer';
import { noopTracer } from './tracer';
import type { Meter } from './meter';
import { noopMeter } from './meter';
import type { TracePropagation, AttributeTarget } from './types';

export type { TracePropagation, AttributeTarget };

const defaultPrefix = 'almanac' as const;

export type Sampler = {
  shouldSample(name: string, attributes?: Record<string, unknown>): boolean;
};

export type ObservabilityConfig<Prefix extends string = typeof defaultPrefix> =
  {
    tracer?: Tracer;
    meter?: Meter;
    propagation?: TracePropagation;
    attributeTarget?: AttributeTarget;
    attributePrefix?: Prefix;
    sampler?: Sampler;
  };

export type ObservabilityOptions<Prefix extends string = typeof defaultPrefix> =
  {
    observability?: ObservabilityConfig<Prefix>;
  };

export type ResolvedObservability<
  Prefix extends string = typeof defaultPrefix,
> = {
  tracer: Tracer;
  meter: Meter;
  propagation: TracePropagation;
  attributeTarget: AttributeTarget;
  attributePrefix: Prefix;
  sampler: Sampler;
};

export const alwaysSample: Sampler = { shouldSample: () => true };
export const neverSample: Sampler = { shouldSample: () => false };
export const rateSample = (rate: number): Sampler => ({
  shouldSample: () => Math.random() < rate,
});

export const resolveObservability = <
  Prefix extends string = typeof defaultPrefix,
>(
  options?: ObservabilityOptions<Prefix>,
  parent?: ObservabilityOptions<Prefix>,
  defaultPfx: Prefix = defaultPrefix as Prefix,
): ResolvedObservability<Prefix> => ({
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
  attributePrefix:
    options?.observability?.attributePrefix ??
    parent?.observability?.attributePrefix ??
    defaultPfx,
  sampler:
    options?.observability?.sampler ??
    parent?.observability?.sampler ??
    alwaysSample,
});
