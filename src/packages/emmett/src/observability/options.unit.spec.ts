import { noopMeter, noopTracer } from '@event-driven-io/almanac';
import { describe, expect, it } from 'vitest';
import {
  consumerObservability,
  mergeObservabilityOptions,
  type ProcessorObservabilityConfig,
  workflowObservability,
} from './options';

describe('mergeObservabilityOptions', () => {
  it('returns the original options when defaults are missing', () => {
    const options = {
      processorId: 'test',
      observability: { propagation: 'propagate' as const },
    };

    const result = mergeObservabilityOptions(options, undefined);

    expect(result).toBe(options);
  });

  it('applies defaults when options observability is missing', () => {
    const options: {
      processorId: string;
      observability?: ProcessorObservabilityConfig;
    } = { processorId: 'test' };
    const tracer = noopTracer();
    const meter = noopMeter();

    const result = mergeObservabilityOptions(options, { tracer, meter });

    expect(result).not.toBe(options);
    expect(result.observability).toEqual({ tracer, meter });
  });

  it('lets options observability override defaults', () => {
    const defaultTracer = noopTracer();
    const optionsTracer = noopTracer();
    const meter = noopMeter();
    const options: {
      processorId: string;
      observability: ProcessorObservabilityConfig;
    } = {
      processorId: 'test',
      observability: {
        tracer: optionsTracer,
        propagation: 'propagate' as const,
      },
    };

    const result = mergeObservabilityOptions(options, {
      tracer: defaultTracer,
      meter,
      attributeTarget: 'both' as const,
    });

    expect(result.observability).toEqual({
      tracer: optionsTracer,
      meter,
      attributeTarget: 'both',
      propagation: 'propagate',
    });
  });

  it('merges consumer observability into processor options', () => {
    const tracer = noopTracer();
    const meter = noopMeter();
    const options: {
      processorId: string;
      observability: ProcessorObservabilityConfig;
    } = {
      processorId: 'test',
      observability: { propagation: 'propagate' },
    };

    const result = mergeObservabilityOptions(options, {
      tracer,
      meter,
      pollTracing: 'verbose' as const,
    });

    expect(result.observability).toEqual({
      tracer,
      meter,
      pollTracing: 'verbose',
      propagation: 'propagate',
    });
  });
});

describe('consumerObservability', () => {
  it('returns noop tracer, meter, pollTracing=off, attributeTarget=both when no options', () => {
    const resolved = consumerObservability(undefined);
    expect(resolved.tracer).toBeDefined();
    expect(resolved.meter).toBeDefined();
    expect(resolved.pollTracing).toBe('off');
    expect(resolved.attributeTarget).toBe('both');
  });

  it('uses provided pollTracing', () => {
    const resolved = consumerObservability({
      observability: { pollTracing: 'active' },
    });
    expect(resolved.pollTracing).toBe('active');
  });

  it('uses provided pollTracing=verbose', () => {
    const resolved = consumerObservability({
      observability: { pollTracing: 'verbose' },
    });
    expect(resolved.pollTracing).toBe('verbose');
  });

  it('falls back to parent pollTracing', () => {
    const resolved = consumerObservability(undefined, {
      observability: { pollTracing: 'active' },
    });
    expect(resolved.pollTracing).toBe('active');
  });

  it('uses provided attributeTarget', () => {
    const resolved = consumerObservability({
      observability: { attributeTarget: 'mainSpan' },
    });
    expect(resolved.attributeTarget).toBe('mainSpan');
  });

  it('falls back to parent attributeTarget', () => {
    const resolved = consumerObservability(undefined, {
      observability: { attributeTarget: 'currentSpan' },
    });
    expect(resolved.attributeTarget).toBe('currentSpan');
  });
});

describe('workflowObservability', () => {
  it('returns noop tracer, meter, propagation=links, attributeTarget=both when no options', () => {
    const resolved = workflowObservability(undefined);
    expect(resolved.tracer).toBeDefined();
    expect(resolved.meter).toBeDefined();
    expect(resolved.propagation).toBe('links');
    expect(resolved.attributeTarget).toBe('both');
  });

  it('uses provided propagation and attributeTarget', () => {
    const resolved = workflowObservability({
      observability: { propagation: 'propagate', attributeTarget: 'mainSpan' },
    });
    expect(resolved.propagation).toBe('propagate');
    expect(resolved.attributeTarget).toBe('mainSpan');
  });

  it('falls back to parent', () => {
    const resolved = workflowObservability(undefined, {
      observability: { propagation: 'propagate' },
    });
    expect(resolved.propagation).toBe('propagate');
  });

  it('defaults includeMessagePayloads to false', () => {
    const resolved = workflowObservability(undefined);
    expect(resolved.includeMessagePayloads).toBe(false);
  });

  it('uses provided includeMessagePayloads', () => {
    const resolved = workflowObservability({
      observability: { includeMessagePayloads: true },
    });
    expect(resolved.includeMessagePayloads).toBe(true);
  });
});
