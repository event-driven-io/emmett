import { describe, expect, it } from 'vitest';
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

  it('addEvent does not throw', async () => {
    const tracer = noopTracer();
    await tracer.startSpan('test', (span) => {
      span.addEvent('OrderPlaced', { orderId: '123' });
      return Promise.resolve();
    });
  });

  it('recordException does not throw', async () => {
    const tracer = noopTracer();
    await tracer.startSpan('test', (span) => {
      span.recordException(new Error('boom'));
      return Promise.resolve();
    });
  });
});
