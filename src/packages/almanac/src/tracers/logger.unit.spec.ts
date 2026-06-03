import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from './logger';
import {
  consoleLogger,
  logEvent,
  logger,
  noopRecorder,
  severityNumberFor,
  severityTextFor,
  shouldLog,
} from './logger';

describe('logEvent', () => {
  it('stamps severity and timestamp from the level', () => {
    const event = logEvent('info', {
      body: 'hi',
      attributes: { userId: 'u1' },
    });

    expect(event.level).toBe('info');
    expect(event.severityNumber).toBe(9);
    expect(event.severityText).toBe('INFO');
    expect(typeof event.timestamp).toBe('number');
    expect(event.body).toBe('hi');
    expect(event.attributes).toEqual({ userId: 'u1' });
  });
});

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

describe('shouldLog', () => {
  it('drops levels below the configured minimum', () => {
    expect(shouldLog('debug', 'info')).toBe(false);
    expect(shouldLog('error', 'info')).toBe(true);
  });
});

describe('logger', () => {
  const capture = (minLevel?: Parameters<typeof logger>[0]['minLevel']) => {
    const events: LogEvent[] = [];
    const log = logger({ event: (e) => events.push(e), minLevel });
    return { events, log };
  };

  it('maps (attributes, msg) to body + attributes', () => {
    const { events, log } = capture();
    log.info({ userId: 'u1' }, 'hi');

    expect(events).toHaveLength(1);
    expect(events[0]!.body).toBe('hi');
    expect(events[0]!.attributes).toEqual({ userId: 'u1' });
    expect(events[0]!.eventName).toBeUndefined();
  });

  it('lifts the reserved eventName key into the EventName field', () => {
    const { events, log } = capture();
    log.info({ eventName: 'user.registered', userId: 'u1' });

    expect(events[0]!.eventName).toBe('user.registered');
    expect(events[0]!.attributes).toEqual({ userId: 'u1' });
    expect(events[0]!.body).toBeUndefined();
  });

  it('keeps the EventName identity and the Body message distinct', () => {
    const { events, log } = capture();
    log.info(
      { eventName: 'user.registered', userId: 'u1' },
      'New user signed up',
    );

    expect(events[0]!.eventName).toBe('user.registered');
    expect(events[0]!.body).toBe('New user signed up');
    expect(events[0]!.attributes).toEqual({ userId: 'u1' });
  });

  it('maps an Error to the error field', () => {
    const { events, log } = capture();
    const err = new Error('boom');
    log.error(err);

    expect(events[0]!.error).toBe(err);
  });

  it('event(record) forwards a built LogEvent unchanged', () => {
    const { events, log } = capture();
    const record = logEvent('info', {
      eventName: 'order.placed',
      body: 'Order o9 placed',
      attributes: { orderId: 'o9' },
    });
    log.event(record);

    expect(events[0]).toBe(record);
    expect(events[0]!.eventName).toBe('order.placed');
    expect(events[0]!.body).toBe('Order o9 placed');
    expect(events[0]!.attributes).toEqual({ orderId: 'o9' });
  });

  it('drops levels below minLevel', () => {
    const { events, log } = capture('warn');
    log.info({ userId: 'u1' }, 'hi');

    expect(events).toHaveLength(0);
  });
});

describe('noopRecorder', () => {
  it('exposes all 7 levels without throwing', () => {
    const levels = [
      'fatal',
      'error',
      'warn',
      'info',
      'debug',
      'trace',
      'silent',
    ] as const;
    for (const level of levels) {
      expect(() => noopRecorder[level]('message')).not.toThrow();
      expect(() =>
        noopRecorder[level]({ key: 'value' }, 'message'),
      ).not.toThrow();
      expect(() =>
        noopRecorder[level](new Error('boom'), 'oops'),
      ).not.toThrow();
    }
  });
});

describe('consoleLogger', () => {
  it('info delegates to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleLogger.info('hello');
    expect(spy).toHaveBeenCalledWith('hello');
    spy.mockRestore();
  });

  it('error delegates to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogger.error('something failed');
    expect(spy).toHaveBeenCalledWith('something failed');
    spy.mockRestore();
  });

  it('fatal delegates to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogger.fatal('fatal failure');
    expect(spy).toHaveBeenCalledWith('fatal failure');
    spy.mockRestore();
  });

  it('warn delegates to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleLogger.warn('watch out');
    expect(spy).toHaveBeenCalledWith('watch out');
    spy.mockRestore();
  });

  it('passes object + msg to the underlying console method', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleLogger.info({ userId: 'u1' }, 'user logged in');
    expect(spy).toHaveBeenCalledWith('user logged in', { userId: 'u1' });
    spy.mockRestore();
  });

  it('passes Error + msg to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('boom');
    consoleLogger.error(err, 'operation failed');
    expect(spy).toHaveBeenCalledWith('operation failed', err);
    spy.mockRestore();
  });

  it('silent does nothing', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleLogger.silent('shh');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
