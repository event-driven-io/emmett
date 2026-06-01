import { describe, expect, it } from 'vitest';
import { LogEvent } from '../loggers/logger';
import { noopTracer } from './tracer';

describe('noopTracer', () => {
  it('executes the function and returns its result', async () => {
    const tracer = noopTracer();
    const result = await tracer.startSpan('test', () => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('passes a noop ActiveSpan with setAttributes and spanContext', async () => {
    const tracer = noopTracer();
    await tracer.startSpan('test', (span) => {
      span.setAttributes({ key: 'value' });
      const ctx = span.spanContext();
      expect(ctx.traceId).toBe('');
      expect(ctx.spanId).toBe('');
      return Promise.resolve();
    });
  });

  it('propagates errors from the wrapped function', async () => {
    const tracer = noopTracer();
    await expect(
      tracer.startSpan('test', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
  });

  it('supports addLink without throwing', async () => {
    const tracer = noopTracer();
    await tracer.startSpan('test', (span) => {
      span.addLink({ traceId: 'abc', spanId: 'def' });
      return Promise.resolve();
    });
  });

  it('span.log accepts all 7 levels without throwing', async () => {
    const tracer = noopTracer();
    await tracer.startSpan('test', (span) => {
      span.log(LogEvent.info({ orderId: '123' }, 'OrderPlaced'));
      span.log(LogEvent.error(new Error('boom'), 'operation failed'));
      span.log(LogEvent.warn('degraded'));
      span.log(LogEvent.debug('details'));
      span.log(LogEvent.trace('verbose'));
      span.log(LogEvent.fatal('critical'));
      span.log(LogEvent.silent('shh'));
      return Promise.resolve();
    });
  });
});
