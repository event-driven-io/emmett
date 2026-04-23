import { describe, expect, it } from 'vitest';
import { ObservabilityScope } from './scope';
import type { ScopeObservability } from './scope';
import { collectingTracer } from './testing';
import { alwaysSample, neverSample } from './options';

const defaultObservability = (
  overrides?: Partial<ScopeObservability>,
): ScopeObservability => ({
  tracer: collectingTracer(),
  sampler: alwaysSample,
  attributePrefix: 'almanac',
  ...overrides,
});

describe('ObservabilityScope', () => {
  it('startScope executes the function and returns its result', async () => {
    const o11y = defaultObservability();
    const result = await ObservabilityScope(o11y).startScope('test', () =>
      Promise.resolve(42),
    );
    expect(result).toBe(42);
  });

  it('root scope setAttributes sets on root span', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({ tracer });

    await ObservabilityScope(o11y).startScope('root', (scope) => {
      scope.setAttributes({ x: 1 });
      return Promise.resolve();
    });

    expect(tracer.spans[0]!.attributes).toHaveProperty('x', 1);
  });

  it('child scope with target=mainSpan sets attributes on root span only', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({
      tracer,
      attributeTarget: 'mainSpan',
    });

    await ObservabilityScope(o11y).startScope('root', async (scope) => {
      await scope.scope('child', (child) => {
        child.setAttributes({ x: 1 });
        return Promise.resolve();
      });
    });

    expect(tracer.spans[0]!.attributes).toHaveProperty('x', 1);
    expect(tracer.spans[1]!.attributes).not.toHaveProperty('x');
  });

  it('child scope with target=currentSpan sets attributes on child span only', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({
      tracer,
      attributeTarget: 'currentSpan',
    });

    await ObservabilityScope(o11y).startScope('root', async (scope) => {
      await scope.scope('child', (child) => {
        child.setAttributes({ x: 1 });
        return Promise.resolve();
      });
    });

    expect(tracer.spans[0]!.attributes).not.toHaveProperty('x');
    expect(tracer.spans[1]!.attributes).toHaveProperty('x', 1);
  });

  it('child scope with target=both sets attributes on both spans', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({ tracer, attributeTarget: 'both' });

    await ObservabilityScope(o11y).startScope('root', async (scope) => {
      await scope.scope('child', (child) => {
        child.setAttributes({ x: 1 });
        return Promise.resolve();
      });
    });

    expect(tracer.spans[0]!.attributes).toHaveProperty('x', 1);
    expect(tracer.spans[1]!.attributes).toHaveProperty('x', 1);
  });

  it('addEvent delegates to underlying span', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({ tracer });

    await ObservabilityScope(o11y).startScope('root', (scope) => {
      scope.addEvent('test', { key: 'val' });
      return Promise.resolve();
    });

    expect(tracer.spans[0]!.events).toEqual([
      { name: 'test', attributes: { key: 'val' } },
    ]);
  });

  it('recordException delegates to underlying span', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({ tracer });
    const error = new Error('boom');

    await ObservabilityScope(o11y).startScope('root', (scope) => {
      scope.recordException(error);
      return Promise.resolve();
    });

    expect(tracer.spans[0]!.exceptions).toEqual([error]);
  });

  it('spanContext returns the underlying span context', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({ tracer });

    await ObservabilityScope(o11y).startScope('root', (scope) => {
      const ctx = scope.spanContext();
      expect(ctx.traceId).toBeDefined();
      expect(ctx.spanId).toBeDefined();
      return Promise.resolve();
    });
  });

  it('child scopes nest correctly', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({ tracer });

    await ObservabilityScope(o11y).startScope('root', async (scope) => {
      await scope.scope('a', async (a) => {
        await a.scope('b', () => Promise.resolve());
      });
    });

    expect(tracer.spans.map((s) => s.name)).toEqual(['root', 'a', 'b']);
  });

  it('root scope carries {prefix}.scope.main=true', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({ tracer });

    await ObservabilityScope(o11y).startScope('root', () => Promise.resolve());

    expect(tracer.spans[0]!.attributes).toHaveProperty(
      'almanac.scope.main',
      true,
    );
  });

  it('child scopes do NOT carry {prefix}.scope.main', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({ tracer });

    await ObservabilityScope(o11y).startScope('root', async (scope) => {
      await scope.scope('child', () => Promise.resolve());
    });

    expect(tracer.spans[1]!.attributes).not.toHaveProperty(
      'almanac.scope.main',
    );
  });

  it('uses custom attributePrefix when provided', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({ tracer, attributePrefix: 'myapp' });

    await ObservabilityScope(o11y).startScope('root', () => Promise.resolve());

    expect(tracer.spans[0]!.attributes).toHaveProperty(
      'myapp.scope.main',
      true,
    );
  });

  it('creation-time attributes land on the local span', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({
      tracer,
      attributeTarget: 'mainSpan',
    });

    await ObservabilityScope(o11y).startScope('root', async (scope) => {
      await scope.scope('child', () => Promise.resolve(), {
        attributes: { op: 'receive' },
      });
    });

    expect(tracer.spans[1]!.attributes).toHaveProperty('op', 'receive');
  });

  it('per-call target override', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({
      tracer,
      attributeTarget: 'currentSpan',
    });

    await ObservabilityScope(o11y).startScope('root', async (scope) => {
      await scope.scope('child', (child) => {
        child.setAttributes({ x: 1 }, { target: 'mainSpan' });
        return Promise.resolve();
      });
    });

    expect(tracer.spans[0]!.attributes).toHaveProperty('x', 1);
    expect(tracer.spans[1]!.attributes).not.toHaveProperty('x');
  });

  it('startScope creation-time attributes land on root span', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({ tracer });

    await ObservabilityScope(o11y).startScope('root', () => Promise.resolve(), {
      attributes: { op: 'handle' },
    });

    expect(tracer.spans[0]!.attributes).toHaveProperty('op', 'handle');
  });

  it('defaultAttributes from factory land on every root span', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({ tracer });

    const factory = ObservabilityScope(o11y, {
      defaultAttributes: { 'stream.name': 'checkout' },
    });

    await factory.startScope('op1', () => Promise.resolve());
    await factory.startScope('op2', () => Promise.resolve());

    expect(tracer.spans[0]!.attributes).toHaveProperty(
      'stream.name',
      'checkout',
    );
    expect(tracer.spans[1]!.attributes).toHaveProperty(
      'stream.name',
      'checkout',
    );
  });

  it('per-operation attributes override defaultAttributes', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({ tracer });

    await ObservabilityScope(o11y, {
      defaultAttributes: { key: 'default' },
    }).startScope('root', () => Promise.resolve(), {
      attributes: { key: 'override' },
    });

    expect(tracer.spans[0]!.attributes).toHaveProperty('key', 'override');
  });

  it('sampler rejection bypasses tracer but still runs fn', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({ tracer, sampler: neverSample });

    const result = await ObservabilityScope(o11y).startScope('test', () =>
      Promise.resolve(42),
    );

    expect(result).toBe(42);
    expect(tracer.spans).toHaveLength(0);
  });
});
