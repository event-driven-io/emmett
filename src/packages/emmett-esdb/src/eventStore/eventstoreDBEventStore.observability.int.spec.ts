import {
  MessagingAttributes,
  ObservabilitySpec,
} from '@event-driven-io/almanac';
import {
  EmmettAttributes,
  MessagingSystemName,
  type Event,
} from '@event-driven-io/emmett';
import type { StartedEventStoreDBContainer } from '@event-driven-io/emmett-testcontainers';
import { EventStoreDBContainer } from '@event-driven-io/emmett-testcontainers';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEventStoreDBEventStore } from './eventstoreDBEventStore';

type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: { productId: string; quantity: number; price: number } }
>;

void describe('EventStoreDBEventStore observability', () => {
  const M = MessagingAttributes;
  const given = ObservabilitySpec.for();
  const withDeadline = { timeout: 30000 };
  let eventStoreDB: StartedEventStoreDBContainer;

  beforeAll(async () => {
    eventStoreDB = await new EventStoreDBContainer().start();
  });

  afterAll(async () => {
    try {
      await eventStoreDB.stop();
    } catch (error) {
      console.log(error);
    }
  });

  const productItem = {
    productId: '123',
    quantity: 10,
    price: 3,
  };

  void it(
    'should record observability while appending',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-${uuid()}`;

      await given((observability) => ({
        eventStore: getEventStoreDBEventStore(eventStoreDB.getClient(), {
          observability,
        }),
      }))
        .when(({ eventStore }) =>
          eventStore.appendToStream<ProductItemAdded>(streamName, [
            { type: 'ProductItemAdded', data: { productItem } },
          ]),
        )
        .then(({ spans }) => {
          spans.hasSingleSpanNamed('eventStore.appendToStream').hasAttributes({
            [EmmettAttributes.scope.main]: true,
            [EmmettAttributes.eventStore.operation]: 'appendToStream',
            [EmmettAttributes.stream.name]: streamName,
            [EmmettAttributes.eventStore.append.batchSize]: 1,
            [EmmettAttributes.eventStore.append.status]: 'success',
            [EmmettAttributes.stream.versionAfter]: 0,
            [M.operation.type]: 'send',
            [M.batch.messageCount]: 1,
            [M.destination.name]: streamName,
            [M.system]: MessagingSystemName,
          });
        });
    },
  );

  void it(
    'persists the observability id set onto appended events',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-${uuid()}`;

      await given(async (observability) => {
        const eventStore = getEventStoreDBEventStore(eventStoreDB.getClient(), {
          observability,
        });
        await eventStore.appendToStream<ProductItemAdded>(streamName, [
          { type: 'ProductItemAdded', data: { productItem } },
        ]);
        return eventStore;
      })
        .when((eventStore) =>
          eventStore.readStream<ProductItemAdded>(streamName),
        )
        .then(({ result }) => {
          const metadata = result.events[0]!.metadata as {
            messageId: string;
            correlationId?: string;
            causationId?: string;
            traceId?: string;
            spanId?: string;
          };

          expect(typeof metadata.correlationId).toBe('string');
          expect(metadata.correlationId!.length).toBeGreaterThan(0);
          // causationId self-roots to the event's own messageId when unset
          expect(metadata.causationId).toBe(metadata.messageId);
          expect(typeof metadata.traceId).toBe('string');
          expect(metadata.traceId!.length).toBeGreaterThan(0);
          expect(typeof metadata.spanId).toBe('string');
          expect(metadata.spanId!.length).toBeGreaterThan(0);
        });
    },
  );

  void it(
    'should record observability while reading',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-${uuid()}`;

      await given(async (observability) => {
        const eventStore = getEventStoreDBEventStore(eventStoreDB.getClient(), {
          observability,
        });
        await eventStore.appendToStream<ProductItemAdded>(streamName, [
          { type: 'ProductItemAdded', data: { productItem } },
        ]);
        return eventStore;
      })
        .when((eventStore) =>
          eventStore.readStream<ProductItemAdded>(streamName),
        )
        .then(({ spans }) => {
          spans
            .hasSingleSpanNamed('eventStore.readStream', { noParent: true })
            .hasAttributes({
              [EmmettAttributes.scope.main]: true,
              [EmmettAttributes.eventStore.operation]: 'readStream',
              [EmmettAttributes.stream.name]: streamName,
              [EmmettAttributes.eventStore.read.status]: 'success',
              [EmmettAttributes.eventStore.read.eventCount]: 1,
              [EmmettAttributes.eventStore.read.eventTypes]: [
                'ProductItemAdded',
              ],
              [M.operation.type]: 'receive',
              [M.destination.name]: streamName,
              [M.system]: MessagingSystemName,
            });
        });
    },
  );

  void it(
    'should record observability while aggregating stream',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-${uuid()}`;

      await given(async (observability) => {
        const eventStore = getEventStoreDBEventStore(eventStoreDB.getClient(), {
          observability,
        });
        await eventStore.appendToStream<ProductItemAdded>(streamName, [
          { type: 'ProductItemAdded', data: { productItem } },
        ]);
        return eventStore;
      })
        .when((eventStore) =>
          eventStore.aggregateStream<
            { productItemsCount: number },
            ProductItemAdded
          >(streamName, {
            initialState: () => ({ productItemsCount: 0 }),
            evolve: (state: { productItemsCount: number }) => ({
              productItemsCount: state.productItemsCount + 1,
            }),
          }),
        )
        .then(({ spans }) => {
          const aggregateSpan = spans
            .hasSingleSpanNamed('eventStore.aggregateStream', {
              noParent: true,
            })
            .hasAttributes({
              [EmmettAttributes.scope.main]: true,
              [EmmettAttributes.eventStore.operation]: 'aggregateStream',
              [EmmettAttributes.stream.name]: streamName,
              [EmmettAttributes.eventStore.aggregate.status]: 'success',
              [EmmettAttributes.stream.versionAfter]: 0,
              [M.operation.type]: 'process',
              [M.destination.name]: streamName,
              [M.system]: MessagingSystemName,
            });

          aggregateSpan.hasChildNamed('eventStore.readStream').hasAttributes({
            [EmmettAttributes.scope.main]: undefined,
            [EmmettAttributes.eventStore.operation]: 'readStream',
            [EmmettAttributes.stream.name]: streamName,
            [EmmettAttributes.eventStore.read.status]: 'success',
            [EmmettAttributes.eventStore.read.eventCount]: 1,
            [EmmettAttributes.eventStore.read.eventTypes]: ['ProductItemAdded'],
            [M.operation.type]: 'receive',
            [M.destination.name]: streamName,
            [M.system]: MessagingSystemName,
          });
        });
    },
  );
});
