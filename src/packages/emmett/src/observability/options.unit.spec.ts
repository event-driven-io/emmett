import { describe, expect, it } from 'vitest';
import { collectingTracer, collectingMeter } from '@event-driven-io/almanac';
import {
  resolveCommandObservability,
  resolveProcessorObservability,
  resolveConsumerObservability,
  resolveWorkflowObservability,
} from './options';

describe('resolveCommandObservability', () => {
  it('returns noop tracer, meter, attributeTarget=both when no options', () => {
    const resolved = resolveCommandObservability(undefined);
    expect(resolved.tracer).toBeDefined();
    expect(resolved.meter).toBeDefined();
    expect(resolved.attributeTarget).toBe('both');
  });

  it('uses provided tracer and meter', () => {
    const tracer = collectingTracer();
    const meter = collectingMeter();
    const resolved = resolveCommandObservability({
      observability: { tracer, meter },
    });
    expect(resolved.tracer).toBe(tracer);
    expect(resolved.meter).toBe(meter);
  });

  it('uses provided attributeTarget', () => {
    const resolved = resolveCommandObservability({
      observability: { attributeTarget: 'mainSpan' },
    });
    expect(resolved.attributeTarget).toBe('mainSpan');
  });

  it('falls back to parent options', () => {
    const tracer = collectingTracer();
    const resolved = resolveCommandObservability(undefined, {
      observability: { tracer },
    });
    expect(resolved.tracer).toBe(tracer);
  });

  it('child overrides parent', () => {
    const parentTracer = collectingTracer();
    const childTracer = collectingTracer();
    const resolved = resolveCommandObservability(
      { observability: { tracer: childTracer } },
      { observability: { tracer: parentTracer } },
    );
    expect(resolved.tracer).toBe(childTracer);
  });
});

describe('resolveProcessorObservability', () => {
  it('returns noop tracer, meter, propagation=links, attributeTarget=both when no options', () => {
    const resolved = resolveProcessorObservability(undefined);
    expect(resolved.tracer).toBeDefined();
    expect(resolved.meter).toBeDefined();
    expect(resolved.propagation).toBe('links');
    expect(resolved.attributeTarget).toBe('both');
  });

  it('uses provided propagation', () => {
    const resolved = resolveProcessorObservability({
      observability: { propagation: 'propagate' },
    });
    expect(resolved.propagation).toBe('propagate');
  });

  it('uses provided attributeTarget', () => {
    const resolved = resolveProcessorObservability({
      observability: { attributeTarget: 'currentSpan' },
    });
    expect(resolved.attributeTarget).toBe('currentSpan');
  });

  it('falls back to parent', () => {
    const resolved = resolveProcessorObservability(undefined, {
      observability: { propagation: 'propagate' },
    });
    expect(resolved.propagation).toBe('propagate');
  });

  it('child overrides parent', () => {
    const resolved = resolveProcessorObservability(
      { observability: { propagation: 'propagate' } },
      { observability: { propagation: 'links' } },
    );
    expect(resolved.propagation).toBe('propagate');
  });
});

describe('resolveConsumerObservability', () => {
  it('returns noop tracer, meter, and pollTracing=off when no options', () => {
    const resolved = resolveConsumerObservability(undefined);
    expect(resolved.tracer).toBeDefined();
    expect(resolved.meter).toBeDefined();
    expect(resolved.pollTracing).toBe('off');
  });

  it('uses provided pollTracing', () => {
    const resolved = resolveConsumerObservability({
      observability: { pollTracing: 'active' },
    });
    expect(resolved.pollTracing).toBe('active');
  });

  it('uses provided pollTracing=verbose', () => {
    const resolved = resolveConsumerObservability({
      observability: { pollTracing: 'verbose' },
    });
    expect(resolved.pollTracing).toBe('verbose');
  });

  it('falls back to parent pollTracing', () => {
    const resolved = resolveConsumerObservability(undefined, {
      observability: { pollTracing: 'active' },
    });
    expect(resolved.pollTracing).toBe('active');
  });
});

describe('resolveWorkflowObservability', () => {
  it('returns noop tracer, meter, propagation=links, attributeTarget=both when no options', () => {
    const resolved = resolveWorkflowObservability(undefined);
    expect(resolved.tracer).toBeDefined();
    expect(resolved.meter).toBeDefined();
    expect(resolved.propagation).toBe('links');
    expect(resolved.attributeTarget).toBe('both');
  });

  it('uses provided propagation and attributeTarget', () => {
    const resolved = resolveWorkflowObservability({
      observability: { propagation: 'propagate', attributeTarget: 'mainSpan' },
    });
    expect(resolved.propagation).toBe('propagate');
    expect(resolved.attributeTarget).toBe('mainSpan');
  });

  it('falls back to parent', () => {
    const resolved = resolveWorkflowObservability(undefined, {
      observability: { propagation: 'propagate' },
    });
    expect(resolved.propagation).toBe('propagate');
  });
});
