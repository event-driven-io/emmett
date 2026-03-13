import { describe, expect, it } from 'vitest';
import { resolveObservability, alwaysSample, rateSample } from './options';
import { collectingTracer, collectingMeter } from './testing';

describe('resolveObservability', () => {
  it('returns noop tracer, meter, propagation=links, attributeTarget=both, prefix=almanac, sampler=alwaysSample when no options', () => {
    const resolved = resolveObservability();

    expect(resolved.propagation).toBe('links');
    expect(resolved.attributeTarget).toBe('both');
    expect(resolved.attributePrefix).toBe('almanac');
    expect(resolved.sampler).toBe(alwaysSample);
    expect(resolved.tracer).toBeDefined();
    expect(resolved.meter).toBeDefined();
  });

  it('uses provided values', () => {
    const tracer = collectingTracer();
    const meter = collectingMeter();
    const sampler = { shouldSample: () => false };

    const resolved = resolveObservability({
      observability: {
        tracer,
        meter,
        propagation: 'propagate',
        attributeTarget: 'mainSpan',
        attributePrefix: 'myapp',
        sampler,
      },
    });

    expect(resolved.tracer).toBe(tracer);
    expect(resolved.meter).toBe(meter);
    expect(resolved.propagation).toBe('propagate');
    expect(resolved.attributeTarget).toBe('mainSpan');
    expect(resolved.attributePrefix).toBe('myapp');
    expect(resolved.sampler).toBe(sampler);
  });

  it('falls back to parent', () => {
    const tracer = collectingTracer();
    const resolved = resolveObservability(undefined, {
      observability: { tracer, propagation: 'propagate' },
    });

    expect(resolved.tracer).toBe(tracer);
    expect(resolved.propagation).toBe('propagate');
  });

  it('child overrides parent', () => {
    const parentTracer = collectingTracer();
    const childTracer = collectingTracer();

    const resolved = resolveObservability(
      { observability: { tracer: childTracer } },
      { observability: { tracer: parentTracer } },
    );

    expect(resolved.tracer).toBe(childTracer);
  });

  it('uses provided sampler', () => {
    const sampler = { shouldSample: () => false };
    const resolved = resolveObservability({
      observability: { sampler },
    });

    expect(resolved.sampler).toBe(sampler);
  });

  it('rateSample(0) rejects all samples', () => {
    const sampler = rateSample(0);
    const results = Array.from({ length: 100 }, () =>
      sampler.shouldSample('test'),
    );
    expect(results.every((r) => r === false)).toBe(true);
  });

  it('rateSample(1) accepts all samples', () => {
    const sampler = rateSample(1);
    const results = Array.from({ length: 100 }, () =>
      sampler.shouldSample('test'),
    );
    expect(results.every((r) => r === true)).toBe(true);
  });
});
