import { describe, expect, it } from 'vitest';
import { LogEvent } from '../loggers/logger';
import { logEventForSpan } from './spanLogEvent';

describe('logEventForSpan', () => {
  it('returns the same event when context is already complete', () => {
    const event = LogEvent(
      'hi',
      { body: 'hi' },
      {
        level: 'info',
        traceId: 'trace-1',
        spanId: 'span-1',
      },
    );

    const completed = logEventForSpan(event, {
      traceId: 'trace-2',
      spanId: 'span-2',
    });

    expect(completed).toBe(event);
    expect(completed.metadata.traceId).toBe('trace-1');
    expect(completed.metadata.spanId).toBe('span-1');
  });

  it('copies only when it fills missing context', () => {
    const event = LogEvent('hi', { body: 'hi' }, { level: 'info' });
    const completed = logEventForSpan(event, {
      traceId: 'trace-1',
      spanId: 'span-1',
    });

    expect(completed).not.toBe(event);
    expect(completed.data).toBe(event.data);
    expect(completed.metadata.traceId).toBe('trace-1');
    expect(completed.metadata.spanId).toBe('span-1');
  });

  it('preserves event-provided ids and fills only missing ids', () => {
    const event = LogEvent(
      'hi',
      { body: 'hi' },
      {
        level: 'info',
        traceId: 'event-trace',
      },
    );
    const completed = logEventForSpan(event, {
      traceId: 'span-trace',
      spanId: 'span-id',
    });

    expect(completed.metadata.traceId).toBe('event-trace');
    expect(completed.metadata.spanId).toBe('span-id');
  });
});
