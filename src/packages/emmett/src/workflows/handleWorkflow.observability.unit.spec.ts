import {
  ObservabilitySpec,
  collectingTracer,
  testObservabilityContextGenerator,
} from '@event-driven-io/almanac';
import { describe, expect, it } from 'vitest';
import { getInMemoryEventStore } from '../eventStore';
import {
  EmmettAttributes,
  MessagingAttributes,
  MessagingSystemName,
} from '../observability';
import { WorkflowHandler, workflowStreamName } from './handleWorkflow';
import {
  workflowOptions,
  type InitiateGroupCheckout,
} from './workflow.testHelpers';

describe('WorkflowHandler observability', () => {
  it('uses configured context generators for workflow message context and persisted message id', async () => {
    const groupCheckoutId = 'group-checkout-1';
    const streamName = workflowStreamName({
      workflowName: 'GroupCheckoutWorkflow',
      workflowId: groupCheckoutId,
    });
    const workflowContext = testObservabilityContextGenerator({
      traceIds: ['workflow-trace', 'event-store-trace'],
      spanIds: ['workflow-span', 'event-store-span'],
      messageIds: 'workflow-input-message',
      correlationIds: 'workflow-correlation',
      causationIds: 'unused-causation',
    });
    const storeContext = testObservabilityContextGenerator({
      traceIds: 'store-trace',
      spanIds: 'store-span',
      messageIds: ['stored-input-message', 'stored-output-message'],
    });
    const store = getInMemoryEventStore({
      observability: { contextGenerator: storeContext },
    });
    const handle = WorkflowHandler({
      ...workflowOptions,
      observability: {
        tracer: collectingTracer({ contextGenerator: workflowContext }),
        contextGenerator: workflowContext,
      },
    });
    const command: InitiateGroupCheckout = {
      type: 'InitiateGroupCheckout',
      kind: 'Command',
      data: {
        groupCheckoutId,
        clerkId: 'clerk-1',
        guestStayAccountIds: ['guest-1'],
        now: new Date('2026-01-01T00:00:00.000Z'),
      },
    };

    await handle(store, command);

    const { events } = await store.readStream(streamName);
    expect(events[0]!.metadata).toMatchObject({
      messageId: 'stored-input-message',
      originalMessageId: 'workflow-input-message',
      correlationId: 'workflow-correlation',
      causationId: 'workflow-input-message',
      traceId: 'workflow-trace',
      spanId: 'workflow-span',
    });
    expect(events[1]!.metadata).toMatchObject({
      messageId: 'stored-output-message',
      correlationId: 'workflow-correlation',
      causationId: 'workflow-input-message',
      traceId: 'workflow-trace',
      spanId: 'workflow-span',
    });
  });

  it('nests aggregate, read and append spans under workflow.handle', async () => {
    const groupCheckoutId = 'group-checkout-2';
    const streamName = workflowStreamName({
      workflowName: 'GroupCheckoutWorkflow',
      workflowId: groupCheckoutId,
    });
    const command: InitiateGroupCheckout = {
      type: 'InitiateGroupCheckout',
      kind: 'Command',
      data: {
        groupCheckoutId,
        clerkId: 'clerk-1',
        guestStayAccountIds: ['guest-1'],
        now: new Date('2026-01-01T00:00:00.000Z'),
      },
    };

    await ObservabilitySpec.for()((observability) => ({
      store: getInMemoryEventStore({ observability }),
      handle: WorkflowHandler({
        ...workflowOptions,
        observability,
      }),
    }))
      .when(({ handle, store }) => handle(store, command))
      .then(({ spans }) => {
        const workflowSpan = spans
          .hasSingleSpanNamed('workflow.handle')
          .hasAttributes({
            [EmmettAttributes.scope.type]: 'workflow',
            [EmmettAttributes.scope.main]: true,
            [EmmettAttributes.workflow.id]: groupCheckoutId,
            [EmmettAttributes.workflow.type]: 'GroupCheckoutWorkflow',
            [EmmettAttributes.workflow.inputType]: 'InitiateGroupCheckout',
            [MessagingAttributes.system]: MessagingSystemName,
          });

        const aggregateSpan = workflowSpan
          .hasChildNamed('eventStore.aggregateStream')
          .hasAttributes({
            [EmmettAttributes.scope.main]: undefined,
            [EmmettAttributes.eventStore.operation]: 'aggregateStream',
            [EmmettAttributes.stream.name]: streamName,
            [EmmettAttributes.eventStore.aggregate.status]: 'success',
            [EmmettAttributes.stream.versionAfter]: 0,
            [MessagingAttributes.operation.type]: 'process',
            [MessagingAttributes.destination.name]: streamName,
            [MessagingAttributes.system]: MessagingSystemName,
          });

        aggregateSpan.hasChildNamed('eventStore.readStream').hasAttributes({
          [EmmettAttributes.scope.main]: undefined,
          [EmmettAttributes.eventStore.operation]: 'readStream',
          [EmmettAttributes.stream.name]: streamName,
          [EmmettAttributes.eventStore.read.status]: 'success',
          [EmmettAttributes.eventStore.read.eventCount]: 0,
          [EmmettAttributes.eventStore.read.eventTypes]: [],
          [MessagingAttributes.operation.type]: 'receive',
          [MessagingAttributes.destination.name]: streamName,
          [MessagingAttributes.system]: MessagingSystemName,
        });

        workflowSpan.hasChildNamed('eventStore.appendToStream').hasAttributes({
          [EmmettAttributes.scope.main]: undefined,
          [EmmettAttributes.eventStore.operation]: 'appendToStream',
          [EmmettAttributes.stream.name]: streamName,
          [EmmettAttributes.eventStore.append.batchSize]: 3,
          [EmmettAttributes.eventStore.append.status]: 'success',
          [EmmettAttributes.stream.versionAfter]: 3,
          [MessagingAttributes.operation.type]: 'send',
          [MessagingAttributes.batch.messageCount]: 3,
          [MessagingAttributes.destination.name]: streamName,
          [MessagingAttributes.system]: MessagingSystemName,
        });
      });
  });
});
