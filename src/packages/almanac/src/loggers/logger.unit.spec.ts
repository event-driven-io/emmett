import { describe, expect, it } from 'vitest';
import type { LogEvent as LogEventValue } from './logger';
import { LogEvent, logger, noopLogger, shouldLog } from './logger';

describe('LogEvent', () => {
  it('builds named events', () => {
    const error = new Error();

    const event = LogEvent(
      'hi',
      {
        body: 'Hi Oskar',
        error,
        attributes: { userId: 'u1' },
      },
      { level: 'info' },
    );

    expect(event.name).toBe('hi');
    expect(event.data).toEqual({
      body: 'Hi Oskar',
      error,
      attributes: { userId: 'u1' },
    });
    expect(event.metadata.level).toBe('info');
    expect(typeof event.metadata.timestamp).toBe('number');
    expect(event.metadata.traceId).toBeUndefined();
    expect(event.metadata.spanId).toBeUndefined();
  });

  it('uses explicit metadata while building named events', () => {
    const event = LogEvent(
      'hi',
      { body: 'hi' },
      {
        level: 'info',
        timestamp: 123,
        traceId: 'trace-1',
        spanId: 'span-1',
      },
    );

    expect(event.metadata.level).toBe('info');
    expect(event.metadata.timestamp).toBe(123);
    expect(event.metadata.traceId).toBe('trace-1');
    expect(event.metadata.spanId).toBe('span-1');
  });

  it('builds message events', () => {
    const event = LogEvent.message('info', 'hi', {
      attributes: { userId: 'u1' },
    });

    expect(event.name).toBe('hi');
    expect(event.data.body).toBe('hi');
    expect(event.data.attributes).toEqual({ userId: 'u1' });
    expect(event.metadata.level).toBe('info');
    expect(typeof event.metadata.timestamp).toBe('number');
    expect(event.metadata.traceId).toBeUndefined();
    expect(event.metadata.spanId).toBeUndefined();
  });

  it('can stamp explicit trace context while building message events', () => {
    const event = LogEvent.message('info', 'hi', undefined, {
      traceId: 'trace-1',
      spanId: 'span-1',
    });

    expect(event.metadata.traceId).toBe('trace-1');
    expect(event.metadata.spanId).toBe('span-1');
  });

  it('supports destructurable pino-like event factories', () => {
    const { info, error } = LogEvent;
    const infoEvent = info({ eventName: 'user.registered', userId: 'u1' });
    const err = new Error('boom');
    const errorEvent = error(err, 'operation.failed');

    expect(infoEvent.name).toBe('user.registered');
    expect(infoEvent.metadata.level).toBe('info');
    expect(infoEvent.data.attributes).toEqual({ userId: 'u1' });
    expect(errorEvent.name).toBe('operation.failed');
    expect(errorEvent.metadata.level).toBe('error');
    expect(errorEvent.data.error).toBe(err);
    expect(errorEvent.metadata.traceId).toBeUndefined();
    expect(errorEvent.metadata.spanId).toBeUndefined();
  });
});

describe('shouldLog', () => {
  it('drops levels below the configured minimum', () => {
    expect(shouldLog('debug', 'info')).toBe(false);
    expect(shouldLog('error', 'info')).toBe(true);
  });
});

describe('logger', () => {
  const capture = (minLevel?: Parameters<typeof logger>[0]['minLevel']) => {
    const events: LogEventValue[] = [];
    const log = logger({ event: (e) => events.push(e), minLevel });
    return { events, log };
  };

  it('maps (attributes, msg) to body + attributes', () => {
    const { events, log } = capture();
    log(LogEvent.info({ userId: 'u1' }, 'hi'));

    expect(events).toHaveLength(1);
    expect(events[0]!.data.body).toBe('hi');
    expect(events[0]!.data.attributes).toEqual({ userId: 'u1' });
    expect(events[0]!.name).toBe('hi');
  });

  it('lifts the reserved eventName key into the EventName field', () => {
    const { events, log } = capture();
    log(LogEvent.info({ eventName: 'user.registered', userId: 'u1' }));

    expect(events[0]!.name).toBe('user.registered');
    expect(events[0]!.data.attributes).toEqual({ userId: 'u1' });
    expect(events[0]!.data.body).toBeUndefined();
  });

  it('keeps the EventName identity and the Body message distinct', () => {
    const { events, log } = capture();
    log(
      LogEvent.info(
        { eventName: 'user.registered', userId: 'u1' },
        'New user signed up',
      ),
    );

    expect(events[0]!.name).toBe('user.registered');
    expect(events[0]!.data.body).toBe('New user signed up');
    expect(events[0]!.data.attributes).toEqual({ userId: 'u1' });
  });

  it('maps an Error to the error field', () => {
    const { events, log } = capture();
    const err = new Error('boom');
    log(LogEvent.error(err));

    expect(events[0]!.data.error).toBe(err);
  });

  it('forwards a built LogEvent unchanged', () => {
    const { events, log } = capture();
    const event = LogEvent(
      'order.placed',
      {
        body: 'Order o9 placed',
        attributes: { orderId: 'o9' },
      },
      { level: 'info' },
    );
    log(event);

    expect(events[0]).toBe(event);
    expect(events[0]!.name).toBe('order.placed');
    expect(events[0]!.data.body).toBe('Order o9 placed');
    expect(events[0]!.data.attributes).toEqual({ orderId: 'o9' });
  });

  it('drops levels below minLevel', () => {
    const { events, log } = capture('warn');
    log(LogEvent.info({ userId: 'u1' }, 'hi'));

    expect(events).toHaveLength(0);
  });

  it('does not expose pino-like methods', () => {
    const { log } = capture();

    expect(typeof log).toBe('function');
    expect((log as unknown as { info?: unknown }).info).toBeUndefined();
    expect((log as unknown as { event?: unknown }).event).toBeUndefined();
  });
});

describe('noopLogger', () => {
  it('accepts LogEvents without throwing', () => {
    expect(() => noopLogger(LogEvent.info('message'))).not.toThrow();
    expect(() =>
      noopLogger(LogEvent.info({ key: 'value' }, 'message')),
    ).not.toThrow();
    expect(() =>
      noopLogger(LogEvent.error(new Error('boom'), 'oops')),
    ).not.toThrow();
  });
});
