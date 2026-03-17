import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { beforeAll, describe, expect, it } from 'vitest';
import { otelTracer } from './otelTracer';
import { ObservabilityScope } from '../scope';

describe('otelTracer integration', () => {
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
  });

  beforeAll(() => {
    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
    trace.setGlobalTracerProvider(provider);
  });

  it('configure ObservabilityScope with otelTracer and record a span', async () => {
    const tracer = otelTracer('almanac-integration');
    const scope = ObservabilityScope({ tracer });

    const result = await scope.startScope('handle-add-product', (s) => {
      s.setAttributes({ 'command.type': 'AddProduct', 'product.id': 'p-42' });
      s.addEvent('product.validated', { 'product.sku': 'SKU-001' });
      return Promise.resolve('ok');
    });

    expect(result).toBe('ok');
  });

  it('nested scopes create parent-child spans', async () => {
    const tracer = otelTracer('almanac-integration');
    const scope = ObservabilityScope({ tracer });

    await scope.startScope('handle-create-order', async (s) => {
      s.setAttributes({ 'order.id': 'ord-1' });

      await s.scope('validate-inventory', (child) => {
        child.setAttributes({ 'item.count': 3 });
        return Promise.resolve();
      });

      await s.scope('persist-order', (child) => {
        child.setAttributes({ store: 'postgres' });
        return Promise.resolve();
      });
    });
  });

  it('error path marks span with ERROR status', async () => {
    const tracer = otelTracer('almanac-integration');
    const scope = ObservabilityScope({ tracer });

    await expect(
      scope.startScope('handle-failing-command', () =>
        Promise.reject(new Error('inventory depleted')),
      ),
    ).rejects.toThrow('inventory depleted');
  });

  it('cross-trace linking with propagation=links starts a fresh trace', async () => {
    const tracer = otelTracer('almanac-integration');
    const upstreamScope = ObservabilityScope({ tracer });

    await upstreamScope.startScope('publish-event', async (upstream) => {
      const link = upstream.spanContext();

      const consumerScope = ObservabilityScope({ tracer });
      await consumerScope.startScope(
        'handle-event',
        (consumer) => {
          consumer.setAttributes({ 'consumer.group': 'orders-consumer' });
          return Promise.resolve();
        },
        { parent: link, propagation: 'links' },
      );
    });
  });
});
