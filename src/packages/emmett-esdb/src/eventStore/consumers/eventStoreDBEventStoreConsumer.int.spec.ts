import type { EmmettError } from '@event-driven-io/emmett';
import {
  assertFails,
  assertFalse,
  assertMatches,
  assertNotEqual,
  assertThatArray,
  assertThrowsAsync,
  assertTrue,
  getInMemoryDatabase,
  inMemorySingleStreamProjection,
  type MessageProcessor,
  type ReadEvent,
} from '@event-driven-io/emmett';
import type { StartedEventStoreDBContainer } from '@event-driven-io/emmett-testcontainers';
import { EventStoreDBContainer } from '@event-driven-io/emmett-testcontainers';
import type { EventStoreDBClient } from '@eventstore/db-client';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';
import { v4 as uuid } from 'uuid';
import type {
  ProductItemAdded,
  ShoppingCartConfirmed,
} from '../../testing/shoppingCart.domain';
import {
  getEventStoreDBEventStore,
  type EventStoreDBEventStore,
} from '../eventstoreDBEventStore';
import {
  eventStoreDBEventStoreConsumer,
  type EventStoreDBEventStoreConsumer,
} from './eventStoreDBEventStoreConsumer';

void describe('EventStoreDB event store consumer', () => {
  let eventStoreDB: StartedEventStoreDBContainer;
  let connectionString: string;
  const dummyProcessor: MessageProcessor = {
    type: 'reactor',
    id: uuid(),
    instanceId: uuid(),
    init: () => Promise.resolve(),
    start: () => Promise.resolve('BEGINNING'),
    close: () => Promise.resolve(),
    handle: () => Promise.resolve(),
    whenProcessed: () => Promise.resolve(),
    isActive: false,
  };

  beforeAll(async () => {
    eventStoreDB = await new EventStoreDBContainer().start();
    connectionString = eventStoreDB.getConnectionString();
  });

  afterAll(async () => {
    try {
      await eventStoreDB.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('creates not-started consumer for the specified connection string', () => {
    const consumer = eventStoreDBEventStoreConsumer({
      connectionString,
      processors: [dummyProcessor],
    });

    assertFalse(consumer.isRunning);
  });

  void it('creates not-started consumer if connection string targets not existing EventStoreDB database', () => {
    const connectionStringToNotExistingDB =
      'esdb://not-existing:2113?tls=false';
    const consumer = eventStoreDBEventStoreConsumer({
      connectionString: connectionStringToNotExistingDB,
      processors: [dummyProcessor],
    });

    assertFalse(consumer.isRunning);
  });

  void describe('created consumer', () => {
    let consumer: EventStoreDBEventStoreConsumer;

    beforeEach(() => {
      consumer = eventStoreDBEventStoreConsumer({
        connectionString,
        processors: [dummyProcessor],
      });
    });
    afterEach(() => {
      return consumer.stop();
    });

    void it('subscribes to existing event store', () => {
      consumer.start().catch(() => assertFails());

      assertTrue(consumer.isRunning);
    });

    void it('fails to start if connection string targets not existing EventStoreDB database', async () => {
      const connectionStringToNotExistingDB =
        'esdb://not-existing:2113?tls=false';
      const consumerToNotExistingServer = eventStoreDBEventStoreConsumer({
        connectionString: connectionStringToNotExistingDB,
        processors: [dummyProcessor],
      });
      await assertThrowsAsync(
        () => consumerToNotExistingServer.start(),
        (error) => {
          return 'type' in error && error.type === 'unavailable';
        },
      );
    });

    void it('fails to start if there are no processors', async () => {
      const consumerToNotExistingServer = eventStoreDBEventStoreConsumer({
        connectionString,
        processors: [],
      });
      await assertThrowsAsync<EmmettError>(
        () => consumerToNotExistingServer.start(),
        (error) => {
          return (
            error.message ===
            'Cannot start consumer without at least a single processor'
          );
        },
      );
    });

    void it('started resolves after successful start', async () => {
      const startedConsumer = eventStoreDBEventStoreConsumer({
        connectionString,
        processors: [dummyProcessor],
      });
      try {
        void startedConsumer.start();
        await startedConsumer.whenStarted();
        assertTrue(startedConsumer.isRunning);
      } finally {
        await startedConsumer.stop();
      }
    });

    void it('started rejects if there are no processors', async () => {
      const consumerWithoutProcessors = eventStoreDBEventStoreConsumer({
        connectionString,
        processors: [],
      });
      try {
        try {
          consumerWithoutProcessors.start().catch(() => {});
        } catch {
          // start() may throw synchronously on validation failure
        }
        await assertThrowsAsync<EmmettError>(
          () => consumerWithoutProcessors.whenStarted(),
          (error) =>
            error.message ===
            'Cannot start consumer without at least a single processor',
        );
      } finally {
        await consumerWithoutProcessors.stop();
      }
    });

    void it(`stopping not started consumer doesn't fail`, async () => {
      await consumer.stop();

      assertFalse(consumer.isRunning);
    });

    void it(`stopping not started consumer is idempotent`, async () => {
      await consumer.stop();
      await consumer.stop();

      assertFalse(consumer.isRunning);
    });
  });

  void describe('started consumer', () => {
    let consumer: EventStoreDBEventStoreConsumer;

    beforeEach(() => {
      consumer = eventStoreDBEventStoreConsumer({
        connectionString,
        processors: [dummyProcessor],
      });
    });
    afterEach(() => consumer.stop());

    void it('stops started consumer', async () => {
      await consumer.stop();

      assertFalse(consumer.isRunning);
    });
  });

  void describe('consumer created by the event store', () => {
    let client: EventStoreDBClient;
    let eventStore: EventStoreDBEventStore;
    const database = getInMemoryDatabase();
    const summaries = database.collection<ShoppingCartSummary>(
      shoppingCartsSummaryCollectionName,
    );
    const productItem = { price: 10, productId: uuid(), quantity: 10 };
    const confirmedAt = new Date();
    const summaryEvents: ShoppingCartSummaryEvent[] = [
      { type: 'ProductItemAdded', data: { productItem } },
      { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
    ];

    beforeAll(() => {
      client = eventStoreDB.getClient();
      eventStore = getEventStoreDBEventStore(client);
    });

    void it('catches up with events appended before it was started', async () => {
      const streamName = `shopping_cart-${uuid()}`;
      const { lastEventGlobalPosition } = await eventStore.appendToStream(
        streamName,
        summaryEvents,
      );

      const consumer = eventStore.consumer();
      consumer.projector<ShoppingCartSummaryEvent>({
        processorId: uuid(),
        projection: shoppingCartsSummaryProjection,
        connectionOptions: { database },
        stopAfter: (event) =>
          event.metadata.globalPosition === lastEventGlobalPosition,
      });

      try {
        await consumer.start();

        assertMatches(await summaries.findOne((d) => d._id === streamName), {
          _id: streamName,
          status: 'confirmed',
          productItemsCount: productItem.quantity,
        });
      } finally {
        await consumer.close();
      }
    });

    void it('leaves the event store usable after the consumer is closed', async () => {
      const consumer = eventStore.consumer({ processors: [dummyProcessor] });
      await consumer.close();

      const streamName = `shopping_cart-${uuid()}`;
      await eventStore.appendToStream(streamName, summaryEvents);

      const result = await eventStore.readStream(streamName);

      assertThatArray(result.events).hasSize(summaryEvents.length);
    });

    void it('returns distinct consumers, each consuming on its own', async () => {
      const first = eventStore.consumer();
      const second = eventStore.consumer();

      assertNotEqual(first.consumerId, second.consumerId);

      const firstHandled: string[] = [];
      const secondHandled: string[] = [];
      const streamName = `shopping_cart-${uuid()}`;

      first.reactor<ShoppingCartSummaryEvent>({
        processorId: uuid(),
        eachMessage: (message) => {
          if (message.metadata.streamName === streamName)
            firstHandled.push(message.type);
        },
      });
      second.reactor<ShoppingCartSummaryEvent>({
        processorId: uuid(),
        eachMessage: (message) => {
          if (message.metadata.streamName === streamName)
            secondHandled.push(message.type);
        },
      });

      let firstPromise: Promise<void> | undefined;
      let secondPromise: Promise<void> | undefined;

      try {
        firstPromise = first.start();
        secondPromise = second.start();
        await first.whenStarted();
        await second.whenStarted();

        await eventStore.appendToStream(streamName, summaryEvents);

        await first.whenCaughtUp();
        await second.whenCaughtUp();

        assertThatArray(firstHandled).hasSize(summaryEvents.length);
        assertThatArray(secondHandled).hasSize(summaryEvents.length);

        await first.close();
        await firstPromise;
        firstPromise = undefined;

        await eventStore.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { productItem } },
        ]);

        await second.whenCaughtUp();

        assertThatArray(firstHandled).hasSize(summaryEvents.length);
        assertThatArray(secondHandled).hasSize(summaryEvents.length + 1);
      } finally {
        if (firstPromise) {
          await first.close();
          await firstPromise;
        }
        await second.close();
        await secondPromise;
      }
    });
  });
});

type ShoppingCartSummary = {
  _id?: string;
  productItemsCount: number;
  status: string;
};

type ShoppingCartSummaryEvent = ProductItemAdded | ShoppingCartConfirmed;

const shoppingCartsSummaryCollectionName = 'shoppingCartsSummary';

const shoppingCartsSummaryProjection = inMemorySingleStreamProjection({
  collectionName: shoppingCartsSummaryCollectionName,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    status: 'pending',
    productItemsCount: 0,
  }),
  evolve: (
    document: ShoppingCartSummary,
    { type, data }: ReadEvent<ShoppingCartSummaryEvent>,
  ): ShoppingCartSummary => {
    switch (type) {
      case 'ProductItemAdded':
        return {
          ...document,
          productItemsCount:
            document.productItemsCount + data.productItem.quantity,
        };
      case 'ShoppingCartConfirmed':
        return {
          ...document,
          status: 'confirmed',
        };
      default:
        return document;
    }
  },
});
