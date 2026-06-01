import { describe, expect, it } from 'vitest';
import { LogEvent } from '../loggers/logger';
import { collectingTracer } from './collectingTracer';
import { testTraceContextGenerator } from './traceContextGenerator';

describe('collectingTracer', () => {
  it('uses an injected trace context generator for collected spans', async () => {
    const tracer = collectingTracer({
      traceContextGenerator: testTraceContextGenerator({
        traceIds: ['trace-1'],
        spanIds: ['span-1'],
      }),
    });

    await tracer.startSpan('test-span', (span) => {
      span.log(LogEvent.info('hello'));
      return Promise.resolve();
    });

    expect(tracer.spans[0]!.ownContext).toEqual({
      traceId: 'trace-1',
      spanId: 'span-1',
    });
    expect(tracer.spans[0]!.logs[0]!.metadata.traceId).toBe('trace-1');
    expect(tracer.spans[0]!.logs[0]!.metadata.spanId).toBe('span-1');
  });

  it('preserves ids supplied directly on event metadata', async () => {
    const tracer = collectingTracer({
      traceContextGenerator: testTraceContextGenerator({
        traceIds: ['trace-1'],
        spanIds: ['span-1'],
      }),
    });

    await tracer.startSpan('test-span', (span) => {
      span.log(
        LogEvent(
          'manual',
          { body: 'manual' },
          {
            level: 'info',
            traceId: 'event-trace',
            spanId: 'event-span',
          },
        ),
      );
      return Promise.resolve();
    });

    expect(tracer.spans[0]!.logs[0]!.metadata.traceId).toBe('event-trace');
    expect(tracer.spans[0]!.logs[0]!.metadata.spanId).toBe('event-span');
  });

  it('supports trace context generator sequences', async () => {
    const tracer = collectingTracer({
      traceContextGenerator: testTraceContextGenerator({
        traceIds: ['trace-1', 'trace-2'],
        spanIds: ['span-1', 'span-2'],
      }),
    });

    await tracer.startSpan('first', () => Promise.resolve());
    await tracer.startSpan('second', () => Promise.resolve());

    expect(tracer.spans.map((s) => s.ownContext)).toEqual([
      { traceId: 'trace-1', spanId: 'span-1' },
      { traceId: 'trace-2', spanId: 'span-2' },
    ]);
  });
});
