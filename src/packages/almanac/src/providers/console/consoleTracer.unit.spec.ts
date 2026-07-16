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
import { testObservabilityContextGenerator } from '../../testing';
import { consoleTracer } from './consoleTracer';

type OtlpSpan = {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Record<string, unknown>;
  status: { code: string; message?: string };
  links: { traceId: string; spanId: string }[];
};

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

  it('logs an OTLP-shaped span summary after execution', async () => {
    const tracer = consoleTracer();
    await tracer.startSpan('my-span', async () => {});

    assert.strictEqual(consoleSpy.mock.calls.length, 1);
    const [output] = consoleSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(output) as OtlpSpan;
    assert.strictEqual(parsed.name, 'my-span');
  });

  it('span summary includes traceId and spanId from the configured generator', async () => {
    const tracer = consoleTracer({
      contextGenerator: testObservabilityContextGenerator({
        traceIds: 'a'.repeat(32),
        spanIds: 'b'.repeat(16),
      }),
    });
    await tracer.startSpan('my-span', async () => {});

    const [output] = consoleSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(output) as OtlpSpan;
    assert.strictEqual(parsed.traceId, 'a'.repeat(32));
    assert.strictEqual(parsed.spanId, 'b'.repeat(16));
  });

  it('span summary carries start and end unix-nano timestamps', async () => {
    const tracer = consoleTracer();
    await tracer.startSpan('my-span', async () => {});

    const [output] = consoleSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(output) as OtlpSpan;
    assert.ok(/^\d+$/.test(parsed.startTimeUnixNano));
    assert.ok(/^\d+$/.test(parsed.endTimeUnixNano));
    assert.ok(
      BigInt(parsed.endTimeUnixNano) >= BigInt(parsed.startTimeUnixNano),
    );
  });

  it('span summary has status OK on success', async () => {
    const tracer = consoleTracer();
    await tracer.startSpan('my-span', async () => {});

    const [output] = consoleSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(output) as OtlpSpan;
    assert.strictEqual(parsed.status.code, 'OK');
  });

  it('span summary carries parentSpanId from the parent option', async () => {
    const tracer = consoleTracer();
    await tracer.startSpan('my-span', async () => {}, {
      parent: { traceId: 'a'.repeat(32), spanId: 'c'.repeat(16) },
    });

    const [output] = consoleSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(output) as OtlpSpan;
    assert.strictEqual(parsed.parentSpanId, 'c'.repeat(16));
  });

  describe('logs inline by default', () => {
    it('logs span events before the span summary', async () => {
      const tracer = consoleTracer({ logLevel: 'info' });
      await tracer.startSpan('my-span', (span) => {
        span.log(LogEvent.info('hello from span'));
        return Promise.resolve();
      });

      assert.strictEqual(consoleSpy.mock.calls.length, 2);
      const [firstOutput] = consoleSpy.mock.calls[0] as [string];
      const firstParsed = JSON.parse(firstOutput) as {
        severityText: string;
        body: string;
      };
      assert.strictEqual(firstParsed.severityText, 'INFO');
      assert.strictEqual(firstParsed.body, 'hello from span');
    });

    it('logs carry the span trace_id and span_id', async () => {
      const tracer = consoleTracer({
        logLevel: 'info',
        contextGenerator: testObservabilityContextGenerator({
          traceIds: 'c'.repeat(32),
          spanIds: 'd'.repeat(16),
        }),
      });
      await tracer.startSpan('my-span', (span) => {
        span.log(LogEvent.info('hello from span'));
        return Promise.resolve();
      });

      const [logOutput] = consoleSpy.mock.calls[0] as [string];
      const [summaryOutput] = consoleSpy.mock.calls[1] as [string];
      const log = JSON.parse(logOutput) as {
        traceId: string;
        spanId: string;
      };
      const summary = JSON.parse(summaryOutput) as OtlpSpan;
      assert.strictEqual(log.traceId, summary.traceId);
      assert.strictEqual(log.spanId, summary.spanId);
      assert.strictEqual(log.traceId, 'c'.repeat(32));
      assert.strictEqual(log.spanId, 'd'.repeat(16));
    });
  });

  describe('suppressLogs: true', () => {
    it('suppresses logs, only logs span summary', async () => {
      const tracer = consoleTracer({ suppressLogs: true });
      await tracer.startSpan('my-span', (span) => {
        span.log(LogEvent.info('this should not appear'));
        return Promise.resolve();
      });

      assert.strictEqual(consoleSpy.mock.calls.length, 1);
      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as OtlpSpan;
      assert.strictEqual(parsed.name, 'my-span');
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

    it('logs span summary with ERROR status when span throws', async () => {
      const tracer = consoleTracer();
      await assert.rejects(() =>
        tracer.startSpan('failing-span', () =>
          Promise.reject(new Error('failure')),
        ),
      );

      assert.strictEqual(consoleSpy.mock.calls.length, 1);
      const [output] = consoleSpy.mock.calls[0] as [string];
      const parsed = JSON.parse(output) as OtlpSpan;
      assert.strictEqual(parsed.name, 'failing-span');
      assert.strictEqual(parsed.status.code, 'ERROR');
      assert.strictEqual(parsed.status.message, 'failure');
    });
  });

  describe('pretty mode', () => {
    it('logs span summary with indentation', async () => {
      const tracer = consoleTracer({ mode: 'pretty' });
      await tracer.startSpan('my-span', async () => {});

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.ok(output.includes('\n'));
      const parsed = JSON.parse(output) as OtlpSpan;
      assert.strictEqual(parsed.name, 'my-span');
    });
  });

  describe('simple mode', () => {
    it('logs span summary as [span] name (Xms)', async () => {
      const tracer = consoleTracer({ mode: 'simple' });
      await tracer.startSpan('my-span', async () => {});

      const [output] = consoleSpy.mock.calls[0] as [string];
      assert.ok(output.startsWith('[span] my-span'));
    });
  });
});
