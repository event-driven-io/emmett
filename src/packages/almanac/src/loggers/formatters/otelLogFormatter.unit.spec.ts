import { describe, expect, it } from 'vitest';
import { LogEvent } from '../logger';
import {
  OtelLogFormatter,
  severityNumberFor,
  severityTextFor,
} from './otelLogFormatter';

describe('severity helpers', () => {
  it('maps each level to its OTel severity number', () => {
    expect(severityNumberFor('trace')).toBe(1);
    expect(severityNumberFor('debug')).toBe(5);
    expect(severityNumberFor('info')).toBe(9);
    expect(severityNumberFor('warn')).toBe(13);
    expect(severityNumberFor('error')).toBe(17);
    expect(severityNumberFor('fatal')).toBe(21);
    expect(severityNumberFor('silent')).toBe(0);
  });

  it('maps each level to its uppercase severity text', () => {
    expect(severityTextFor('info')).toBe('INFO');
    expect(severityTextFor('error')).toBe('ERROR');
  });
});

describe('OtelLogFormatter', () => {
  it('keeps trace and span ids native and puts correlation and causation ids in attributes', () => {
    const event = LogEvent.info({ orderId: 'o1' }, 'order placed', {
      timestamp: 1,
      traceId: 'trace-1',
      spanId: 'span-1',
      correlationId: 'corr-1',
      causationId: 'cause-1',
    });

    expect(OtelLogFormatter.toOtelLog(event)).toEqual({
      timestamp: 1,
      severityNumber: 9,
      severityText: 'INFO',
      eventName: 'order placed',
      traceId: 'trace-1',
      spanId: 'span-1',
      body: 'order placed',
      attributes: {
        orderId: 'o1',
        correlation_id: 'corr-1',
        causation_id: 'cause-1',
      },
    });
  });
});
