import {
  defaultObservabilityContextGenerator,
  type ObservabilityContextGenerator,
} from '../../tracers';

export const otelObservabilityContextGenerator: ObservabilityContextGenerator =
  defaultObservabilityContextGenerator;
