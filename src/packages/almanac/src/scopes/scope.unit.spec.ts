import { describe, expect, it } from 'vitest';
import { alwaysSample, neverSample } from '../configuration/options';
import { LogEvent, noopLogger, type AnyLogEvent } from '../loggers/logger';
import {
  collectingTracer,
  testObservabilityContextGenerator,
} from '../testing';
import { noopTracer } from '../tracers';
import type { ScopeObservability } from './scope';
import { noopScope, ObservabilityScope } from './scope';

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

  it('log writes to the configured logger with span context', async () => {
    const tracer = collectingTracer();
    const logs: AnyLogEvent[] = [];
    const o11y = defaultObservability({
      tracer,
      logger: (log) => logs.push(log),
    });

    await ObservabilityScope(o11y).startScope('root', (scope) => {
      scope.log(LogEvent.info({ key: 'val' }, 'test'));
      return Promise.resolve();
    });

    expect(logs).toMatchObject([
      {
        metadata: {
          level: 'info',
          traceId: tracer.spans[0]!.ownContext.traceId,
          spanId: tracer.spans[0]!.ownContext.spanId,
        },
        data: { attributes: { key: 'val' }, body: 'test' },
      },
    ]);
    expect(tracer.spans[0]!.logs).toEqual([]);
  });

  it('log uses the active span logger when no logger is configured', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({ tracer });

    await ObservabilityScope(o11y).startScope('root', (scope) => {
      scope.log(LogEvent.info('test'));
      return Promise.resolve();
    });

    expect(tracer.spans[0]!.logs).toMatchObject([
      {
        data: { body: 'test' },
        metadata: tracer.spans[0]!.ownContext,
      },
    ]);
  });

  it('an explicitly disabled logger suppresses active span logs', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({ tracer, logger: noopLogger });

    await ObservabilityScope(o11y).startScope('root', (scope) => {
      scope.log(LogEvent.info('test'));
      return Promise.resolve();
    });

    expect(tracer.spans[0]!.logs).toEqual([]);
  });

  it('log preserves explicit event context over span context', async () => {
    const tracer = collectingTracer();
    const logs: AnyLogEvent[] = [];
    const o11y = defaultObservability({
      tracer,
      logger: (log) => logs.push(log),
    });

    await ObservabilityScope(o11y).startScope('root', (scope) => {
      scope.log(
        LogEvent.info('test', {
          traceId: 'explicit-trace',
          spanId: 'explicit-span',
        }),
      );
      return Promise.resolve();
    });

    expect(logs[0]!.metadata.traceId).toBe('explicit-trace');
    expect(logs[0]!.metadata.spanId).toBe('explicit-span');
  });

  it('log with noop tracer does not stamp empty context ids', async () => {
    const logs: AnyLogEvent[] = [];
    const o11y = defaultObservability({
      tracer: noopTracer(),
      logger: (log) => logs.push(log),
    });

    await ObservabilityScope(o11y).startScope('root', (scope) => {
      scope.log(LogEvent.info('test'));
      return Promise.resolve();
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]!.metadata.traceId).toBeUndefined();
    expect(logs[0]!.metadata.spanId).toBeUndefined();
  });

  it('sampled out scopes still use the configured logger without span context', async () => {
    const tracer = collectingTracer();
    const logs: AnyLogEvent[] = [];
    const o11y = defaultObservability({
      tracer,
      sampler: neverSample,
      logger: (log) => logs.push(log),
    });

    await ObservabilityScope(o11y).startScope('root', (scope) => {
      scope.log(LogEvent.info('test'));
      return Promise.resolve();
    });

    expect(tracer.spans).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.metadata.traceId).toBeUndefined();
    expect(logs[0]!.metadata.spanId).toBeUndefined();
  });

  it('log.error writes to the configured logger', async () => {
    const tracer = collectingTracer();
    const logs: AnyLogEvent[] = [];
    const o11y = defaultObservability({
      tracer,
      logger: (log) => logs.push(log),
    });
    const error = new Error('boom');

    await ObservabilityScope(o11y).startScope('root', (scope) => {
      scope.log(LogEvent.error(error, 'boom'));
      return Promise.resolve();
    });

    expect(logs).toMatchObject([
      { metadata: { level: 'error' }, data: { error, body: 'boom' } },
    ]);
  });

  it('observabilityContext resolves trace/span from the underlying span', async () => {
    const tracer = collectingTracer();
    const o11y = defaultObservability({ tracer });

    await ObservabilityScope(o11y).startScope('root', (scope) => {
      const ctx = scope.context;
      expect(ctx.traceId).toBe(tracer.spans[0]!.ownContext.traceId);
      expect(ctx.spanId).toBe(tracer.spans[0]!.ownContext.spanId);
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
    expect(tracer.spans[1]!.startOptions.parent).toEqual(
      tracer.spans[0]!.ownContext,
    );
    expect(tracer.spans[2]!.startOptions.parent).toEqual(
      tracer.spans[1]!.ownContext,
    );
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

  describe('observabilityContext', () => {
    it('generates all four ids when nothing is seeded', async () => {
      const o11y = defaultObservability({
        tracer: noopTracer(),
        contextGenerator: testObservabilityContextGenerator({
          traceIds: 'trace-1',
          spanIds: 'span-1',
          correlationIds: 'corr-1',
        }),
      });

      await ObservabilityScope(o11y).startScope('root', (scope) => {
        expect(scope.context).toEqual({
          traceId: 'trace-1',
          spanId: 'span-1',
          correlationId: 'corr-1',
          causationId: undefined,
        });
        return Promise.resolve();
      });
    });

    it('resolves the seeded correlation/causation over the generator', async () => {
      const o11y = defaultObservability({
        tracer: noopTracer(),
        contextGenerator: testObservabilityContextGenerator({
          traceIds: 'trace-1',
          spanIds: 'span-1',
        }),
      });

      await ObservabilityScope(o11y).startScope(
        'root',
        (scope) => {
          expect(scope.context).toEqual({
            traceId: 'trace-1',
            spanId: 'span-1',
            correlationId: 'corr-1',
            causationId: 'cause-1',
          });
          return Promise.resolve();
        },
        { context: { correlationId: 'corr-1', causationId: 'cause-1' } },
      );
    });

    it('a child inherits correlation/causation and mints its own span', async () => {
      const tracer = collectingTracer();
      const o11y = defaultObservability({ tracer });

      await ObservabilityScope(o11y).startScope(
        'root',
        async (scope) => {
          const parent = scope.context;
          await scope.scope('child', (child) => {
            const childContext = child.context;
            expect(childContext.correlationId).toBe(parent.correlationId);
            expect(childContext.causationId).toBe(parent.causationId);
            expect(childContext.spanId).not.toBe(parent.spanId);
            return Promise.resolve();
          });
        },
        { context: { correlationId: 'corr-1', causationId: 'cause-1' } },
      );
    });

    it('a child context overrides the inherited correlation/causation', async () => {
      const o11y = defaultObservability();

      await ObservabilityScope(o11y).startScope(
        'root',
        async (scope) => {
          await scope.scope(
            'child',
            (child) => {
              const childContext = child.context;
              expect(childContext.correlationId).toBe('corr-1');
              expect(childContext.causationId).toBe('cause-2');
              return Promise.resolve();
            },
            { context: { causationId: 'cause-2' } },
          );
        },
        { context: { correlationId: 'corr-1', causationId: 'cause-1' } },
      );
    });

    it('noopScope resolves generated ids', () => {
      const context = noopScope.context;
      expect(typeof context.traceId).toBe('string');
      expect(context.traceId.length).toBeGreaterThan(0);
      expect(typeof context.spanId).toBe('string');
      expect(context.spanId.length).toBeGreaterThan(0);
      expect(typeof context.correlationId).toBe('string');
      expect(context.correlationId.length).toBeGreaterThan(0);
    });

    it('a sampled-out scope still resolves its context', async () => {
      const o11y = defaultObservability({
        sampler: neverSample,
        contextGenerator: testObservabilityContextGenerator({
          traceIds: 'trace-1',
          spanIds: 'span-1',
        }),
      });

      await ObservabilityScope(o11y).startScope(
        'root',
        (scope) => {
          expect(scope.context).toEqual({
            traceId: 'trace-1',
            spanId: 'span-1',
            correlationId: 'corr-1',
            causationId: undefined,
          });
          return Promise.resolve();
        },
        { context: { correlationId: 'corr-1' } },
      );
    });
  });
});
