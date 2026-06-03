import assert from 'assert';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  it,
  vi,
} from 'vitest';
import { consoleSpanRecorder } from './consoleSpanRecorder';

type OtelRecord = {
  timestamp: number;
  severityNumber: number;
  severityText: string;
  body?: string;
  eventName?: string;
  trace_id?: string;
  span_id?: string;
  attributes?: Record<string, unknown>;
};

describe('consoleSpanRecorder', () => {
  let consoleSpy!: MockInstance<typeof console.log>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('compact mode (default)', () => {
    it('writes an OTel-shaped record for a string message', () => {
      const recorder = consoleSpanRecorder({ recordLevel: 'info' });
      recorder.info('hello');

      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as OtelRecord;
      assert.strictEqual(parsed.body, 'hello');
      assert.strictEqual(parsed.severityText, 'INFO');
      assert.strictEqual(parsed.severityNumber, 9);
      assert.strictEqual(typeof parsed.timestamp, 'number');
    });

    it('output has no newlines', () => {
      const recorder = consoleSpanRecorder({ recordLevel: 'info' });
      recorder.info('test');

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.ok(!output.includes('\n'));
    });

    it('keeps object fields under attributes with the message as body', () => {
      const recorder = consoleSpanRecorder({ recordLevel: 'info' });
      recorder.info({ count: 5 }, 'event');

      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as OtelRecord;
      assert.strictEqual(parsed.body, 'event');
      assert.deepStrictEqual(parsed.attributes, { count: 5 });
    });

    it('lifts the reserved eventName key into the EventName field', () => {
      const recorder = consoleSpanRecorder({ recordLevel: 'info' });
      recorder.info({ eventName: 'user.registered', userId: 'u1' });

      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as OtelRecord;
      assert.strictEqual(parsed.eventName, 'user.registered');
      assert.deepStrictEqual(parsed.attributes, { userId: 'u1' });
      assert.strictEqual(parsed.body, undefined);
    });

    it('maps an Error to exception.* attributes', () => {
      const recorder = consoleSpanRecorder();
      recorder.error(new Error('boom'), 'oh no');

      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as OtelRecord;
      assert.strictEqual(parsed.severityText, 'ERROR');
      assert.strictEqual(parsed.body, 'oh no');
      assert.strictEqual(parsed.attributes!['exception.type'], 'Error');
      assert.strictEqual(parsed.attributes!['exception.message'], 'boom');
    });

    it('carries the span trace_id and span_id when provided', () => {
      const recorder = consoleSpanRecorder({
        recordLevel: 'info',
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
      });
      recorder.info('hello');

      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as OtelRecord;
      assert.strictEqual(parsed.trace_id, 'a'.repeat(32));
      assert.strictEqual(parsed.span_id, 'b'.repeat(16));
    });
  });

  describe('compact mode (explicit)', () => {
    it('produces same output as default mode', () => {
      const recorderDefault = consoleSpanRecorder({ recordLevel: 'info' });
      const recorderExplicit = consoleSpanRecorder({
        format: 'compact',
        recordLevel: 'info',
      });

      recorderDefault.info('same');
      recorderExplicit.info('same');

      const [out1] = consoleSpy.mock.calls[0] as [string];
      const [out2] = consoleSpy.mock.calls[1] as [string];
      assert.strictEqual(out1, out2);
    });
  });

  describe('pretty mode', () => {
    it('writes JSON with indentation', () => {
      const recorder = consoleSpanRecorder({
        format: 'pretty',
        recordLevel: 'info',
      });
      recorder.info('hello');

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.ok(output.includes('\n'));
      const parsed = JSON.parse(output) as OtelRecord;
      assert.strictEqual(parsed.body, 'hello');
    });
  });

  describe('simple mode', () => {
    it('writes [level] message for string', () => {
      const recorder = consoleSpanRecorder({
        format: 'simple',
        recordLevel: 'info',
      });
      recorder.info('hello simple');

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.strictEqual(output, '[info] hello simple');
    });

    it('writes [level] message for object with msg', () => {
      const recorder = consoleSpanRecorder({
        format: 'simple',
        recordLevel: 'warn',
      });
      recorder.warn({ foo: 'bar' }, 'something');

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.strictEqual(output, '[warn] something');
    });

    it('falls back to the eventName when no message is given', () => {
      const recorder = consoleSpanRecorder({
        format: 'simple',
        recordLevel: 'debug',
      });
      recorder.debug({ eventName: 'cache.miss', foo: 'bar' });

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.strictEqual(output, '[debug] cache.miss');
    });

    it('writes [level] for object without msg or eventName', () => {
      const recorder = consoleSpanRecorder({
        format: 'simple',
        recordLevel: 'debug',
      });
      recorder.debug({ foo: 'bar' });

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
      it(`records ${level} level`, () => {
        const recorder = consoleSpanRecorder({ recordLevel: level });
        recorder[level](`${level} message`);

        const [output] = consoleSpy.mock.calls[0] as [string];
        const parsed = JSON.parse(output) as OtelRecord;
        assert.strictEqual(parsed.severityText, level.toUpperCase());
      });
    }

    it('silent produces no output', () => {
      const recorder = consoleSpanRecorder();
      recorder.silent('hidden');

      assert.strictEqual(consoleSpy.mock.calls.length, 0);
    });
  });
});
