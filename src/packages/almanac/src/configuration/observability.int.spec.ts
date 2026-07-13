import { describe, expect, it } from 'vitest';
import { LogEvent, type AnyLogEvent } from '../loggers';
import { ObservabilityScope } from '../scopes';
import { collectingTracer } from '../testing';
import { DISABLED } from './options';
import { observability } from './observability';

describe('configured observability', () => {
  it('supports logging without creating trace context', async () => {
    const logs: AnyLogEvent[] = [];
    const configured = observability({ logging: (event) => logs.push(event) });
    const scope = ObservabilityScope(configured);

    await scope.startScope('handle request', (active) => {
      active.log(LogEvent.info('request handled'));
      return Promise.resolve();
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]!.data.body).toBe('request handled');
    expect(logs[0]!.metadata.traceId).toBeUndefined();
    expect(logs[0]!.metadata.spanId).toBeUndefined();
  });

  it('correlates logs when tracing and logging are both configured', async () => {
    const tracing = collectingTracer();
    const logs: AnyLogEvent[] = [];
    const configured = observability({
      tracing,
      logging: (event) => logs.push(event),
    });
    const scope = ObservabilityScope(configured);

    await scope.startScope('handle request', (active) => {
      active.log(LogEvent.info('request handled'));
      return Promise.resolve();
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]!.metadata).toMatchObject(tracing.spans[0]!.ownContext);
  });

  it('keeps logging disabled when only tracing is configured', async () => {
    const tracing = collectingTracer();
    const configured = observability({ tracing });
    const scope = ObservabilityScope(configured);

    await scope.startScope('handle request', (active) => {
      active.log(LogEvent.info('request handled'));
      return Promise.resolve();
    });

    expect(tracing.spans).toHaveLength(1);
    expect(tracing.spans[0]!.logs).toEqual([]);
  });

  it('keeps logging active when tracing is explicitly disabled', async () => {
    const logs: AnyLogEvent[] = [];
    const configured = observability({
      tracing: DISABLED,
      logging: (event) => logs.push(event),
    });
    const scope = ObservabilityScope(configured);

    await scope.startScope('handle request', (active) => {
      active.log(LogEvent.info('request handled'));
      return Promise.resolve();
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]!.data.body).toBe('request handled');
    expect(logs[0]!.metadata.traceId).toBeUndefined();
    expect(logs[0]!.metadata.spanId).toBeUndefined();
  });
});
