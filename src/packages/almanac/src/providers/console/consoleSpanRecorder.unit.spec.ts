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

describe('consoleSpanRecorder', () => {
  let consoleSpy!: MockInstance<typeof console.log>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ndjson mode (default)', () => {
    it('writes compact JSON line for string message', () => {
      const recorder = consoleSpanRecorder();
      recorder.info('hello');

      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as { level: string; msg: string };
      assert.strictEqual(parsed.level, 'info');
      assert.strictEqual(parsed.msg, 'hello');
    });

    it('output has no newlines', () => {
      const recorder = consoleSpanRecorder();
      recorder.info('test');

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.ok(!output.includes('\n'));
    });

    it('spreads object fields into JSON entry', () => {
      const recorder = consoleSpanRecorder();
      recorder.info({ count: 5 }, 'event');

      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as {
        level: string;
        msg: string;
        count: number;
      };
      assert.strictEqual(parsed.msg, 'event');
      assert.strictEqual(parsed.count, 5);
    });

    it('serializes Error under "error" key', () => {
      const recorder = consoleSpanRecorder();
      recorder.error(new Error('boom'), 'oh no');

      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as {
        level: string;
        msg: string;
        error: { type: string; message: string };
      };
      assert.strictEqual(parsed.level, 'error');
      assert.strictEqual(parsed.error.type, 'Error');
      assert.strictEqual(parsed.error.message, 'boom');
    });
  });

  describe('ndjson mode (explicit)', () => {
    it('produces same output as default mode', () => {
      const recorderDefault = consoleSpanRecorder();
      const recorderExplicit = consoleSpanRecorder({ mode: 'ndjson' });

      recorderDefault.info('same');
      recorderExplicit.info('same');

      const [out1] = consoleSpy.mock.calls[0] as [string];
      const [out2] = consoleSpy.mock.calls[1] as [string];
      assert.strictEqual(out1, out2);
    });
  });

  describe('pretty mode', () => {
    it('writes JSON with indentation', () => {
      const recorder = consoleSpanRecorder({ mode: 'pretty' });
      recorder.info('hello');

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.ok(output.includes('\n'));
      const parsed = JSON.parse(output) as { level: string; msg: string };
      assert.strictEqual(parsed.level, 'info');
      assert.strictEqual(parsed.msg, 'hello');
    });
  });

  describe('simple mode', () => {
    it('writes [level] message for string', () => {
      const recorder = consoleSpanRecorder({ mode: 'simple' });
      recorder.info('hello simple');

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.strictEqual(output, '[info] hello simple');
    });

    it('writes [level] message for object with msg', () => {
      const recorder = consoleSpanRecorder({ mode: 'simple' });
      recorder.warn({ foo: 'bar' }, 'something');

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.strictEqual(output, '[warn] something');
    });

    it('writes [level] for object without msg', () => {
      const recorder = consoleSpanRecorder({ mode: 'simple' });
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
        const recorder = consoleSpanRecorder();
        recorder[level](`${level} message`);

        const [output] = consoleSpy.mock.calls[0] as [string];
        const parsed = JSON.parse(output) as { level: string };
        assert.strictEqual(parsed.level, level);
      });
    }

    it('silent produces no output', () => {
      const recorder = consoleSpanRecorder();
      recorder.silent('hidden');

      assert.strictEqual(consoleSpy.mock.calls.length, 0);
    });
  });
});
