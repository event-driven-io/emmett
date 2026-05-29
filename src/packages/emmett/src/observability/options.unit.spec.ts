import { describe, expect, it } from 'vitest';
import {
  resolveConsumerObservability,
  resolveWorkflowObservability,
} from './options';

describe('resolveConsumerObservability', () => {
  it('returns noop tracer, meter, pollTracing=off, attributeTarget=both when no options', () => {
    const resolved = resolveConsumerObservability(undefined);
    expect(resolved.tracer).toBeDefined();
    expect(resolved.meter).toBeDefined();
    expect(resolved.pollTracing).toBe('off');
    expect(resolved.attributeTarget).toBe('both');
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

  it('uses provided attributeTarget', () => {
    const resolved = resolveConsumerObservability({
      observability: { attributeTarget: 'mainSpan' },
    });
    expect(resolved.attributeTarget).toBe('mainSpan');
  });

  it('falls back to parent attributeTarget', () => {
    const resolved = resolveConsumerObservability(undefined, {
      observability: { attributeTarget: 'currentSpan' },
    });
    expect(resolved.attributeTarget).toBe('currentSpan');
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

  it('defaults includeMessagePayloads to false', () => {
    const resolved = resolveWorkflowObservability(undefined);
    expect(resolved.includeMessagePayloads).toBe(false);
  });

  it('uses provided includeMessagePayloads', () => {
    const resolved = resolveWorkflowObservability({
      observability: { includeMessagePayloads: true },
    });
    expect(resolved.includeMessagePayloads).toBe(true);
  });
});
