import {
  ObservabilitySpec,
  testObservabilityContextGenerator,
} from '@event-driven-io/almanac';
import { describe, expect, it } from 'vitest';
import {
  ExpectedVersionConflictError,
  getInMemoryEventStore,
} from '../eventStore';
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
    let metadata: unknown[] = [];

    await ObservabilitySpec.for({ contextGenerator: workflowContext })(
      (observability) => ({
        store: getInMemoryEventStore({
          observability: { contextGenerator: storeContext },
        }),
        handle: WorkflowHandler({
          ...workflowOptions,
          observability,
        }),
      }),
    )
      .when(async ({ handle, store }) => {
        await handle(store, command);
        const { events } = await store.readStream(streamName);
        metadata = events.map((event) => event.metadata);
      })
      .then(() => {
        expect(metadata[0]).toMatchObject({
          messageId: 'stored-input-message',
          originalMessageId: 'workflow-input-message',
          correlationId: 'workflow-correlation',
          causationId: 'workflow-input-message',
          traceId: 'workflow-trace',
          spanId: 'workflow-span',
        });
        expect(metadata[1]).toMatchObject({
          messageId: 'stored-output-message',
          correlationId: 'workflow-correlation',
          causationId: 'workflow-input-message',
          traceId: 'workflow-trace',
          spanId: 'workflow-span',
        });
      });
  });

  it('uses source correlation id even when source message id is missing', async () => {
    const groupCheckoutId = 'group-checkout-with-source-correlation';
    const streamName = workflowStreamName({
      workflowName: 'GroupCheckoutWorkflow',
      workflowId: groupCheckoutId,
    });
    const workflowContext = testObservabilityContextGenerator({
      traceIds: ['workflow-trace', 'event-store-trace'],
      spanIds: ['workflow-span', 'event-store-span'],
      messageIds: 'generated-input-message',
      correlationIds: 'generated-correlation',
    });
    const storeContext = testObservabilityContextGenerator({
      traceIds: 'store-trace',
      spanIds: 'store-span',
      messageIds: ['stored-input-message', 'stored-output-message'],
    });
    const command = {
      type: 'InitiateGroupCheckout',
      kind: 'Command',
      data: {
        groupCheckoutId,
        clerkId: 'clerk-1',
        guestStayAccountIds: ['guest-1'],
        now: new Date('2026-01-01T00:00:00.000Z'),
      },
      metadata: {
        now: new Date('2026-01-01T00:00:00.000Z'),
        correlationId: 'source-correlation',
      },
    } as InitiateGroupCheckout;
    let metadata: unknown[] = [];

    await ObservabilitySpec.for({ contextGenerator: workflowContext })(
      (observability) => ({
        store: getInMemoryEventStore({
          observability: { contextGenerator: storeContext },
        }),
        handle: WorkflowHandler({
          ...workflowOptions,
          observability,
        }),
      }),
    )
      .when(async ({ handle, store }) => {
        await handle(store, command);
        const { events } = await store.readStream(streamName);
        metadata = events.map((event) => event.metadata);
      })
      .then(() => {
        expect(metadata[0]).toMatchObject({
          messageId: 'stored-input-message',
          originalMessageId: 'generated-input-message',
          correlationId: 'source-correlation',
          causationId: 'generated-input-message',
          traceId: 'workflow-trace',
          spanId: 'workflow-span',
        });
        expect(metadata[1]).toMatchObject({
          messageId: 'stored-output-message',
          correlationId: 'source-correlation',
          causationId: 'generated-input-message',
          traceId: 'workflow-trace',
          spanId: 'workflow-span',
        });
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

  it('preserves append operation attributes and links while nesting append under workflow handling', async () => {
    const groupCheckoutId = 'group-checkout-3';
    const streamName = workflowStreamName({
      workflowName: 'GroupCheckoutWorkflow',
      workflowId: groupCheckoutId,
    });
    const externalParent = {
      traceId: 'external-workflow-trace',
      spanId: 'external-workflow-span',
    };
    const appendLink = {
      traceId: 'linked-workflow-trace',
      spanId: 'linked-workflow-span',
    };
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
      .when(({ handle, store }) =>
        handle(store, command, {
          observability: {
            parent: externalParent,
            attributes: { 'test.workflow.append.option': 'kept' },
            links: [appendLink],
          },
        }),
      )
      .then(({ spans }) => {
        const workflowSpan = spans
          .hasSingleSpanNamed('workflow.handle')
          .hasParent(externalParent);

        workflowSpan
          .hasChildNamed('eventStore.appendToStream')
          .hasAttributes({
            'test.workflow.append.option': 'kept',
            [EmmettAttributes.eventStore.operation]: 'appendToStream',
            [EmmettAttributes.stream.name]: streamName,
            [EmmettAttributes.eventStore.append.batchSize]: 3,
            [EmmettAttributes.eventStore.append.status]: 'success',
            [EmmettAttributes.stream.versionAfter]: 3,
            [MessagingAttributes.operation.type]: 'send',
            [MessagingAttributes.batch.messageCount]: 3,
            [MessagingAttributes.destination.name]: streamName,
            [MessagingAttributes.system]: MessagingSystemName,
          })
          .hasCreationLinks([appendLink]);
      });
  });

  it('keeps retry attempts inside a single workflow handling span', async () => {
    const groupCheckoutId = 'group-checkout-retry';
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
    let attempts = 0;

    await ObservabilitySpec.for()((observability) => ({
      store: getInMemoryEventStore({ observability }),
      handle: WorkflowHandler({
        ...workflowOptions,
        workflow: {
          ...workflowOptions.workflow,
          decide: (input, state) => {
            if (attempts++ === 0)
              throw new ExpectedVersionConflictError(0n, 1n);

            return workflowOptions.workflow.decide(input, state);
          },
        },
        observability,
      }),
    }))
      .when(({ handle, store }) =>
        handle(store, command, {
          retry: {
            onVersionConflict: {
              retries: 1,
              minTimeout: 0,
              factor: 1,
            },
          },
        }),
      )
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

        spans
          .haveSpansNamed('eventStore.aggregateStream')
          .hasCount(2)
          .haveParentSpanNamed('workflow.handle')
          .haveAttributes({
            [EmmettAttributes.scope.main]: undefined,
            [EmmettAttributes.eventStore.operation]: 'aggregateStream',
            [EmmettAttributes.stream.name]: streamName,
            [EmmettAttributes.eventStore.aggregate.status]: 'success',
            [EmmettAttributes.stream.versionAfter]: 0,
            [MessagingAttributes.operation.type]: 'process',
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
