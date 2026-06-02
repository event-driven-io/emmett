import assert from 'assert';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  it,
  vi,
} from 'vitest';
import { consoleTracer } from './consoleTracer';

describe('consoleTracer', () => {
  let consoleSpy!: MockInstance<typeof console.log>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the result of the span function', async () => {
    const tracer = consoleTracer();
    const result = await tracer.startSpan('test', () => Promise.resolve(42));

    assert.strictEqual(result, 42);
  });

  it('emits span summary after execution', async () => {
    const tracer = consoleTracer();
    await tracer.startSpan('my-span', async () => {});

    assert.strictEqual(consoleSpy.mock.calls.length, 1);
    const [output] = consoleSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(output) as { span: string };
    assert.strictEqual(parsed.span, 'my-span');
  });

  it('span summary includes traceId (32 hex chars) and spanId (16 hex chars)', async () => {
    const tracer = consoleTracer();
    await tracer.startSpan('my-span', async () => {});

    const [output] = consoleSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(output) as { traceId: string; spanId: string };
    assert.ok(/^[0-9a-f]{32}$/.test(parsed.traceId));
    assert.ok(/^[0-9a-f]{16}$/.test(parsed.spanId));
  });

  it('span summary includes durationMs as a non-negative number', async () => {
    const tracer = consoleTracer();
    await tracer.startSpan('my-span', async () => {});

    const [output] = consoleSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(output) as { durationMs: number };
    assert.ok(typeof parsed.durationMs === 'number');
    assert.ok(parsed.durationMs >= 0);
  });

  it('span summary has ok: true on success', async () => {
    const tracer = consoleTracer();
    await tracer.startSpan('my-span', async () => {});

    const [output] = consoleSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(output) as { ok: boolean };
    assert.strictEqual(parsed.ok, true);
  });

  describe('records emitted inline by default', () => {
    it('emits records inline before the span summary', async () => {
      const tracer = consoleTracer({ recordLevel: 'info' });
      await tracer.startSpan('my-span', (span) => {
        span.record.info('hello from span');
        return Promise.resolve();
      });

      assert.strictEqual(consoleSpy.mock.calls.length, 2);
      const [firstOutput] = consoleSpy.mock.calls[0] as [string];
      const firstParsed = JSON.parse(firstOutput) as {
        level: string;
        msg: string;
      };
      assert.strictEqual(firstParsed.level, 'info');
      assert.strictEqual(firstParsed.msg, 'hello from span');
    });
  });

  describe('suppressRecords: true', () => {
    it('suppresses records, only emits span summary', async () => {
      const tracer = consoleTracer({ suppressRecords: true });
      await tracer.startSpan('my-span', (span) => {
        span.record.info('this should not appear');
        return Promise.resolve();
      });

      assert.strictEqual(consoleSpy.mock.calls.length, 1);
      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as { span: string };
      assert.strictEqual(parsed.span, 'my-span');
    });
  });

  describe('error handling', () => {
    it('propagates exception from span function', async () => {
      const tracer = consoleTracer();
      await assert.rejects(
        () =>
          tracer.startSpan('failing-span', () =>
            Promise.reject(new Error('failure')),
          ),
        (err: Error) => {
          assert.strictEqual(err.message, 'failure');
          return true;
        },
      );
    });

    it('emits span summary even when span throws', async () => {
      const tracer = consoleTracer();
      await assert.rejects(() =>
        tracer.startSpan('failing-span', () =>
          Promise.reject(new Error('failure')),
        ),
      );

      assert.strictEqual(consoleSpy.mock.calls.length, 1);
      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as {
        span: string;
        ok: boolean;
        error: { type: string; message: string };
      };
      assert.strictEqual(parsed.span, 'failing-span');
      assert.strictEqual(parsed.ok, false);
      assert.strictEqual(parsed.error.message, 'failure');
    });
  });

  describe('pretty mode', () => {
    it('emits span summary with indentation', async () => {
      const tracer = consoleTracer({ mode: 'pretty' });
      await tracer.startSpan('my-span', async () => {});

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.ok(output.includes('\n'));
      const parsed = JSON.parse(output) as { span: string };
      assert.strictEqual(parsed.span, 'my-span');
    });
  });

  describe('simple mode', () => {
    it('emits span summary as [span] name (Xms)', async () => {
      const tracer = consoleTracer({ mode: 'simple' });
      await tracer.startSpan('my-span', async () => {});

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.ok(output.startsWith('[span] my-span'));
    });
  });
});
