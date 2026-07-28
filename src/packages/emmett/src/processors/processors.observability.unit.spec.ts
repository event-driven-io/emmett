import {
  ObservabilitySpec,
  testObservabilityContextGenerator,
} from '@event-driven-io/almanac';
import { describe, it } from 'vitest';
import { getInMemoryEventStore } from '../eventStore';
import {
  EmmettAttributes,
  MessagingSystemName,
} from '../observability/attributes';
import { withOperationScope } from '../observability/options';
import { assertDeepEqual } from '../testing';
import type { AnyRecordedMessageMetadata } from '../typing';
import { reactor } from './processors';

const A = EmmettAttributes;
const M = {
  system: 'messaging.system',
  batchMessageCount: 'messaging.batch.message_count',
  operationType: 'messaging.operation.type',
};

const makeMessage = (type: string, meta: Record<string, unknown> = {}) => ({
  type,
  data: {},
  kind: 'Event' as const,
  metadata: meta as unknown as AnyRecordedMessageMetadata,
});

const given = ObservabilitySpec.for();

describe('processors observability wiring', () => {
  it('per-message span uses trace context from message metadata as parent', async () => {
    await given((config) =>
      reactor({
        processorId: 'test',
        eachMessage: () => Promise.resolve(),
        observability: config,
      }),
    )
      .when(async (reactor) => {
        await reactor.start({});
        await reactor.handle(
          [
            makeMessage('OrderPlaced', {
              traceId: 'trace-A',
              spanId: 'span-x',
            }),
          ],
          {},
        );
        await reactor.close({});
      })
      .then(({ spans }) => {
        spans.hasSingleSpanNamed('processor.handle').hasAttributes({
          [A.scope.type]: 'processor',
          [A.scope.main]: true,
          [A.processor.id]: 'test',
          [A.processor.type]: 'reactor',
          [A.processor.batchSize]: 1,
          [A.processor.eventTypes]: ['OrderPlaced'],
          [A.processor.status]: 'ack',
          [M.system]: MessagingSystemName,
          [M.batchMessageCount]: 1,
        });

        spans
          .hasSingleSpanNamed('processor.message.OrderPlaced')
          .hasParent({ traceId: 'trace-A', spanId: 'span-x' })
          .hasAttributes({
            [A.scope.type]: 'reactor',
            [A.processor.id]: 'test',
            [A.processor.type]: 'reactor',
            [M.operationType]: 'process',
          });
      });
  });

  it('per-message span without trace context has no parent', async () => {
    await given((config) =>
      reactor({
        processorId: 'test',
        eachMessage: () => Promise.resolve(),
        observability: config,
      }),
    )
      .when(async (reactor) => {
        await reactor.start({});
        await reactor.handle([makeMessage('OrderPlaced')], {});
        await reactor.close({});
      })
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed('processor.message.OrderPlaced')
          .hasNoParent()
          .hasAttributes({
            [A.scope.type]: 'reactor',
            [A.processor.id]: 'test',
            [A.processor.type]: 'reactor',
            [M.operationType]: 'process',
          }),
      );
  });

  it('root span carries source links from message trace context by default', async () => {
    await given((config) =>
      reactor({
        processorId: 'test',
        eachMessage: () => Promise.resolve(),
        observability: config,
      }),
    )
      .when(async (reactor) => {
        await reactor.start({});
        await reactor.handle(
          [
            makeMessage('OrderPlaced', {
              traceId: 'trace-A',
              spanId: 'span-x',
            }),
          ],
          {},
        );
        await reactor.close({});
      })
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed('processor.handle')
          .hasCreationLinks([{ traceId: 'trace-A', spanId: 'span-x' }]),
      );
  });

  it("per-message span forwards propagation: 'propagate' in StartSpanOptions when configured", async () => {
    await given(
      (config) =>
        reactor({
          processorId: 'test',
          eachMessage: () => Promise.resolve(),
          observability: config,
        }),
      { propagation: 'propagate' as const },
    )
      .when(async (reactor) => {
        await reactor.start({});
        await reactor.handle(
          [
            makeMessage('OrderPlaced', {
              traceId: 'trace-A',
              spanId: 'span-x',
            }),
          ],
          {},
        );
        await reactor.close({});
      })
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed('processor.message.OrderPlaced')
          .hasPropagation('propagate')
          .hasParent({ traceId: 'trace-A', spanId: 'span-x' })
          .hasAttributes({
            [A.scope.type]: 'reactor',
            [A.processor.id]: 'test',
            [A.processor.type]: 'reactor',
            [M.operationType]: 'process',
          }),
      );
  });

  it('logs processing errors on the processor handle span', async () => {
    await given((config) =>
      reactor({
        processorId: 'test',
        processorInstanceId: 'test',
        eachMessage: () => {
          throw new Error('boom');
        },
        observability: config,
      }),
    )
      .when(async (reactor) => {
        await reactor.start({});
        await reactor.handle([makeMessage('OrderPlaced')], {});
        await reactor.close({});
      })
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed('processor.handle')
          .logged(
            'error',
            'Error during message processing for processor test with instance id test. Stopping the processor.',
          ),
      );
  });

  it('what a reactor appends is caused by the message it handles', async () => {
    const eventStore = getInMemoryEventStore({
      observability: {
        contextGenerator: testObservabilityContextGenerator({
          traceIds: 'store-trace',
          spanIds: 'store-span',
          messageIds: 'appended-message',
        }),
      },
    });
    const streamName = 'reaction-1';
    let metadata: AnyRecordedMessageMetadata | undefined;

    await given((config) =>
      reactor({
        processorId: 'test',
        eachMessage: async (_message, context) => {
          await eventStore.appendToStream(
            streamName,
            [{ type: 'OrderConfirmed', kind: 'Event', data: {} }],
            { observability: withOperationScope(context.observabilityScope) },
          );
        },
        observability: config,
      }),
    )
      .when(async (reactor) => {
        await reactor.start({});
        await reactor.handle(
          [
            makeMessage('OrderPlaced', {
              messageId: 'trigger-message',
              correlationId: 'flow-1',
            }),
          ],
          {},
        );
        await reactor.close({});

        const { events } = await eventStore.readStream(streamName);
        metadata = events[0]?.metadata;
      })
      .then(() => {
        const { messageId, correlationId, causationId } = metadata!;

        assertDeepEqual(
          { messageId, correlationId, causationId },
          {
            messageId: 'appended-message',
            correlationId: 'flow-1',
            causationId: 'trigger-message',
          },
        );
      });
  });
});
