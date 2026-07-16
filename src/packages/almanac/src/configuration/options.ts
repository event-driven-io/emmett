import type { AttributeTarget } from '../attributes';
import type { Logger } from '../loggers';
import type { Meter } from '../meters';
import type {
  ObservabilityContextGenerator,
  TracePropagation,
  Tracer,
} from '../tracers';

export const DISABLED = 'DISABLED' as const;

export type Sampler = {
  shouldSample(name: string, attributes?: Record<string, unknown>): boolean;
};

export type Observability<Prefix extends string = 'almanac'> = {
  tracer: Tracer;
  meter: Meter;
  logger: Logger;
  propagation?: TracePropagation;
  contextGenerator?: ObservabilityContextGenerator;
  attributeTarget?: AttributeTarget;
  attributePrefix?: Prefix;
  sampler?: Sampler;
};

export const alwaysSample: Sampler = { shouldSample: () => true };
export const neverSample: Sampler = { shouldSample: () => false };
export const rateSample = (rate: number): Sampler => ({
  shouldSample: () => Math.random() < rate,
});
