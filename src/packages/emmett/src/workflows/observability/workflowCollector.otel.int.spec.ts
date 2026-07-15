import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { otelAssertions, otelTracer } from '@event-driven-io/almanac/otel';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getInMemoryEventStore } from '../../eventStore';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
} from '../../observability';
import { workflowCollector, workflowObservability } from './workflowCollector';

describe('workflowCollector with OTel', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  beforeAll(() => {
    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
    trace.setGlobalTracerProvider(provider);
  });

  beforeEach(() => exporter.reset());

  it('exports workflow.handle span through the OTel provider', async () => {
    const collector = workflowCollector(
      workflowObservability({
        observability: { tracer: otelTracer('emmett-workflow-test') },
      }),
    );

    await collector.startScope(
      {
        workflowId: 'checkout-1',
        workflowType: 'GroupCheckoutWorkflow',
        inputType: 'GuestCheckedOut',
      },
      (scope) => {
        collector.recordStateRebuild(scope, 2);
        collector.recordOutputs(scope, [{ type: 'GroupCheckoutCompleted' }]);
        return Promise.resolve();
      },
    );

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);

    otelAssertions
      .spans(spans)
      .haveSpanNamed('workflow.handle')
      .isMainScope('emmett')
      .hasAttributes({
        [EmmettAttributes.scope.type]: 'workflow',
        [EmmettAttributes.workflow.id]: 'checkout-1',
        [EmmettAttributes.workflow.type]: 'GroupCheckoutWorkflow',
        [EmmettAttributes.workflow.inputType]: 'GuestCheckedOut',
        [EmmettAttributes.workflow.stateRebuildEventCount]: 2,
        [EmmettAttributes.workflow.outputsCount]: 1,
        'messaging.system': MessagingSystemName,
      });
    expect(
      spans[0]!.attributes[EmmettAttributes.workflow.outputs],
    ).toStrictEqual(['GroupCheckoutCompleted']);
  });

  it('records workflow duration metric name in the resolved collector contract', () => {
    expect(EmmettMetrics.workflow.processingDuration).toBe(
      'emmett.workflow.processing.duration',
    );
  });

  it('exports event store append/read spans from a plugged in-memory event store', async () => {
    const store = getInMemoryEventStore({
      observability: { tracer: otelTracer('emmett-event-store-test') },
    });

    await store.appendToStream('orders-1', [
      { type: 'OrderPlaced', data: { orderId: 'orders-1' } },
    ]);
    const readResult = await store.readStream('orders-1');

    expect(readResult.events).toHaveLength(1);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);

    otelAssertions
      .spans(spans)
      .haveSpanNamed('eventStore.appendToStream')
      .hasAttributes({
        [EmmettAttributes.eventStore.operation]: 'appendToStream',
        [EmmettAttributes.stream.name]: 'orders-1',
        [EmmettAttributes.eventStore.append.batchSize]: 1,
        [EmmettAttributes.eventStore.append.status]: 'success',
        [EmmettAttributes.stream.versionAfter]: 1,
        'messaging.operation.type': 'send',
        'messaging.batch.message_count': 1,
        'messaging.destination.name': 'orders-1',
        'messaging.system': MessagingSystemName,
      });

    otelAssertions
      .spans(spans)
      .haveSpanNamed('eventStore.readStream')
      .hasAttributes({
        [EmmettAttributes.eventStore.operation]: 'readStream',
        [EmmettAttributes.stream.name]: 'orders-1',
        [EmmettAttributes.eventStore.read.status]: 'success',
        [EmmettAttributes.eventStore.read.eventCount]: 1,
        'messaging.operation.type': 'receive',
        'messaging.destination.name': 'orders-1',
        'messaging.system': MessagingSystemName,
      });
  });
});
