import assert from 'assert';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  it,
  vi,
} from 'vitest';
import { LogEvent } from '../../loggers/logger';
import { consoleSpanLogger } from './consoleSpanLogger';

type OtelLog = {
  timestamp: number;
  severityNumber: number;
  severityText: string;
  body?: string;
  eventName?: string;
  traceId?: string;
  spanId?: string;
  attributes?: Record<string, unknown>;
};

describe('consoleSpanLogger', () => {
  let consoleSpy!: MockInstance<typeof console.log>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('compact mode (default)', () => {
    it('writes an OTel-shaped log for a string message', () => {
      const logger = consoleSpanLogger({ logLevel: 'info' });
      logger(LogEvent.info('hello'));

      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as OtelLog;
      assert.strictEqual(parsed.body, 'hello');
      assert.strictEqual(parsed.severityText, 'INFO');
      assert.strictEqual(parsed.severityNumber, 9);
      assert.strictEqual(typeof parsed.timestamp, 'number');
    });

    it('output has no newlines', () => {
      const logger = consoleSpanLogger({ logLevel: 'info' });
      logger(LogEvent.info('test'));

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.ok(!output.includes('\n'));
    });

    it('keeps object fields under attributes with the message as body', () => {
      const logger = consoleSpanLogger({ logLevel: 'info' });
      logger(LogEvent.info({ count: 5 }, 'event'));

      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as OtelLog;
      assert.strictEqual(parsed.body, 'event');
      assert.deepStrictEqual(parsed.attributes, { count: 5 });
    });

    it('lifts the reserved eventName key into the EventName field', () => {
      const logger = consoleSpanLogger({ logLevel: 'info' });
      logger(LogEvent.info({ eventName: 'user.registered', userId: 'u1' }));

      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as OtelLog;
      assert.strictEqual(parsed.eventName, 'user.registered');
      assert.deepStrictEqual(parsed.attributes, { userId: 'u1' });
      assert.strictEqual(parsed.body, undefined);
    });

    it('maps an Error to exception.* attributes', () => {
      const logger = consoleSpanLogger();
      logger(LogEvent.error(new Error('boom'), 'oh no'));

      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as OtelLog;
      assert.strictEqual(parsed.severityText, 'ERROR');
      assert.strictEqual(parsed.body, 'oh no');
      assert.strictEqual(parsed.attributes!['exception.type'], 'Error');
      assert.strictEqual(parsed.attributes!['exception.message'], 'boom');
    });

    it('carries traceId and spanId supplied on the event metadata', () => {
      const logger = consoleSpanLogger({ logLevel: 'info' });
      logger({
        name: 'hello',
        data: { body: 'hello' },
        metadata: {
          level: 'info',
          timestamp: 1,
          traceId: 'a'.repeat(32),
          spanId: 'b'.repeat(16),
        },
      });

      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as OtelLog;
      assert.strictEqual(parsed.traceId, 'a'.repeat(32));
      assert.strictEqual(parsed.spanId, 'b'.repeat(16));
    });
  });

  describe('compact mode (explicit)', () => {
    it('produces same output as default mode', () => {
      const loggerDefault = consoleSpanLogger({ logLevel: 'info' });
      const loggerExplicit = consoleSpanLogger({
        format: 'compact',
        logLevel: 'info',
      });

      loggerDefault(LogEvent.info('same'));
      loggerExplicit(LogEvent.info('same'));

      const [out1] = consoleSpy.mock.calls[0] as [string];
      const [out2] = consoleSpy.mock.calls[1] as [string];
      const {
        traceId: _t1,
        spanId: _s1,
        timestamp: _ts1,
        ...rest1
      } = JSON.parse(out1) as OtelLog;
      const {
        traceId: _t2,
        spanId: _s2,
        timestamp: _ts2,
        ...rest2
      } = JSON.parse(out2) as OtelLog;
      assert.deepStrictEqual(rest1, rest2);
    });
  });

  describe('pretty mode', () => {
    it('writes JSON with indentation', () => {
      const logger = consoleSpanLogger({
        format: 'pretty',
        logLevel: 'info',
      });
      logger(LogEvent.info('hello'));

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.ok(output.includes('\n'));
      const parsed = JSON.parse(output) as OtelLog;
      assert.strictEqual(parsed.body, 'hello');
    });
  });

  describe('simple mode', () => {
    it('writes [level] message for string', () => {
      const logger = consoleSpanLogger({
        format: 'simple',
        logLevel: 'info',
      });
      logger(LogEvent.info('hello simple'));

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.strictEqual(output, '[info] hello simple');
    });

    it('writes [level] message for object with msg', () => {
      const logger = consoleSpanLogger({
        format: 'simple',
        logLevel: 'warn',
      });
      logger(LogEvent.warn({ foo: 'bar' }, 'something'));

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.strictEqual(output, '[warn] something');
    });

    it('falls back to the eventName when no message is given', () => {
      const logger = consoleSpanLogger({
        format: 'simple',
        logLevel: 'debug',
      });
      logger(LogEvent.debug({ eventName: 'cache.miss', foo: 'bar' }));

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.strictEqual(output, '[debug] cache.miss');
    });

    it('writes [level] for object without msg or eventName', () => {
      const logger = consoleSpanLogger({
        format: 'simple',
        logLevel: 'debug',
      });
      logger(LogEvent.debug({ foo: 'bar' }));

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.strictEqual(output, '[debug]');
    });
  });

  describe('all levels', () => {
    const levels = [
      'fatal',
      'error',
      'warn',
      'info',
      'debug',
      'trace',
    ] as const;

    for (const level of levels) {
      it(`logs ${level} level`, () => {
        const logger = consoleSpanLogger({ logLevel: level });
        logger(LogEvent[level](`${level} message`));

        const [output] = consoleSpy.mock.calls[0] as [string];
        const parsed = JSON.parse(output) as OtelLog;
        assert.strictEqual(parsed.severityText, level.toUpperCase());
      });
    }

    it('silent produces no output', () => {
      const logger = consoleSpanLogger();
      logger(LogEvent.silent('hidden'));

      assert.strictEqual(consoleSpy.mock.calls.length, 0);
    });
  });
});
