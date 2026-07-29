import {
  assertDeepEqual,
  assertEqual,
  assertMatches,
  assertNotEqual,
  assertTrue,
  type ReadEvent,
} from '@event-driven-io/emmett';
import {
  pongoClient,
  type PongoClient,
  type PongoCollection,
} from '@event-driven-io/pongo';
import { pgDriver } from '@event-driven-io/pongo/pg';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../testing/postgreSQLTestDatabase';
import type {
  ProductItemAdded,
  ShoppingCartConfirmed,
  ShoppingCartEvent,
} from '../../testing/shoppingCart.domain';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import { pongoSingleStreamProjection } from '../projections';
import { postgreSQLEventStoreConsumer } from './postgreSQLEventStoreConsumer';
import type { PostgreSQLProjectorOptions } from './postgreSQLProcessor';

const withDeadline = { timeout: 30000 };

void describe('PostgreSQL event store started consumer', () => {
  let database: PostgreSQLTestDatabase;
  let connectionString: string;
  let eventStore: PostgresEventStore;
  let pongo: PongoClient;
  let summaries: PongoCollection<ShoppingCartSummary>;
  const productItem = { price: 10, productId: uuid(), quantity: 10 };
  const confirmedAt = new Date();

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
    connectionString = database.connectionString;
    eventStore = getPostgreSQLEventStore(connectionString);
    pongo = pongoClient({
      connectionString,
      driver: pgDriver,
      connectionOptions: {
        transactionOptions: {
          allowNestedTransactions: true,
        },
      },
    });
    summaries = pongo.db().collection(shoppingCartsSummaryCollectionName);
    await eventStore.schema.migrate();
  });

  afterAll(async () => {
    try {
      await eventStore?.close();
      await pongo?.close();
      await database?.close();
    } catch (error) {
      console.log(error);
    }
  });

  void describe('eachMessage', () => {
    void it(
      'handles all events appended to event store BEFORE projector was started',
      withDeadline,
      async () => {
        // Given
        const shoppingCartId = `shoppingCart:${uuid()}`;
        const streamName = `shopping_cart-${shoppingCartId}`;
        const events: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
        ];
        const appendResult = await eventStore.appendToStream(
          streamName,
          events,
        );

        // When
        const consumer = postgreSQLEventStoreConsumer<ShoppingCartEvent>({
          connectionString,
        });
        consumer.projector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          stopAfter: (event) =>
            event.metadata.globalPosition ===
            appendResult.lastEventGlobalPosition,
        });

        try {
          await consumer.start();

          const summary = await summaries.findOne({ _id: streamName });

          assertDeepEqual(summary, {
            _id: streamName,
            status: 'confirmed',
            _version: 1n, // because it captures the whole batch of events as one operation
            productItemsCount: productItem.quantity,
          });
        } finally {
          await consumer.close();
        }
      },
    );

    void it(
      'handles all events appended to event store AFTER projector was started',
      withDeadline,
      async () => {
        // Given
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        consumer.projector({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
        });

        const shoppingCartId = `shoppingCart:${uuid()}`;
        const streamName = `shopping_cart-${shoppingCartId}`;
        const events: ShoppingCartSummaryEvent[] = [
          {
            type: 'ProductItemAdded',
            data: {
              productItem,
            },
          },
          {
            type: 'ShoppingCartConfirmed',
            data: { confirmedAt },
          },
        ];

        // When
        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const summary = await summaries.findOne({ _id: streamName });

          assertDeepEqual(summary, {
            _id: streamName,
            status: 'confirmed',
            _version: 1n, // because it captures the whole batch of events as one operation
            productItemsCount: productItem.quantity,
          });
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'handles ONLY events AFTER provided global position',
      withDeadline,
      async () => {
        // Given
        const shoppingCartId = `shoppingCart:${uuid()}`;
        const streamName = `shopping_cart-${shoppingCartId}`;

        const initialEvents: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ProductItemAdded', data: { productItem } },
        ];
        const { lastEventGlobalPosition: startPosition } =
          await eventStore.appendToStream(streamName, initialEvents);

        const events: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          {
            type: 'ShoppingCartConfirmed',
            data: { confirmedAt },
          },
        ];

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        consumer.projector({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          startFrom: {
            lastCheckpoint: startPosition,
          },
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const summary = await summaries.findOne({ _id: streamName });

          assertDeepEqual(summary, {
            _id: streamName,
            status: 'confirmed',
            _version: 1n, // because it captures the whole batch of events as one operation
            productItemsCount: productItem.quantity,
          });
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'handles all events when CURRENT position is NOT stored',
      withDeadline,
      async () => {
        // Given
        const shoppingCartId = `shoppingCart:${uuid()}`;
        const streamName = `shopping_cart-${shoppingCartId}`;

        const initialEvents: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ProductItemAdded', data: { productItem } },
        ];

        await eventStore.appendToStream(streamName, initialEvents);

        const events: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          {
            type: 'ShoppingCartConfirmed',
            data: { confirmedAt },
          },
        ];

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        consumer.projector({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          startFrom: 'CURRENT',
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const summary = await summaries.findOne({ _id: streamName });

          // _version is not asserted here because the pre-existing events and
          // the ones appended after start may land in one or two poll batches
          assertMatches(summary, {
            _id: streamName,
            status: 'confirmed',
            productItemsCount: productItem.quantity * 3,
          });
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'handles only new events when CURRENT position is stored for restarted consumer',
      withDeadline,
      async () => {
        // Given
        const shoppingCartId = `shoppingCart:${uuid()}`;
        const streamName = `shopping_cart-${shoppingCartId}`;

        const initialEvents: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ProductItemAdded', data: { productItem } },
        ];
        const { lastEventGlobalPosition: startPosition } =
          await eventStore.appendToStream(streamName, initialEvents);

        const events: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          {
            type: 'ShoppingCartConfirmed',
            data: { confirmedAt },
          },
        ];

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        consumer.projector({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          startFrom: 'CURRENT',
          stopAfter: (event) => event.metadata.globalPosition === startPosition,
        });

        await consumer.start();
        await consumer.stop();

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const summary = await summaries.findOne({ _id: streamName });

          assertDeepEqual(summary, {
            _id: streamName,
            status: 'confirmed',
            _version: 2n, // because it captures the whole batch of events as one operation
            productItemsCount: productItem.quantity * 3,
          });
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'handles only new events when CURRENT position is stored for a new consumer',
      withDeadline,
      async () => {
        // Given
        const shoppingCartId = `shoppingCart:${uuid()}`;
        const streamName = `shopping_cart-${shoppingCartId}`;

        const initialEvents: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ProductItemAdded', data: { productItem } },
        ];
        const { lastEventGlobalPosition: startPosition } =
          await eventStore.appendToStream(streamName, initialEvents);

        const events: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          {
            type: 'ShoppingCartConfirmed',
            data: { confirmedAt },
          },
        ];

        const processorOptions: PostgreSQLProjectorOptions<ShoppingCartSummaryEvent> =
          {
            processorId: uuid(),
            projection: shoppingCartsSummaryProjection,
            startFrom: 'CURRENT',
            stopAfter: (event) =>
              event.metadata.globalPosition === startPosition,
          };

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        try {
          consumer.projector<ShoppingCartSummaryEvent>(processorOptions);

          await consumer.start();
        } finally {
          await consumer.close();
        }

        const newConsumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        newConsumer.projector<ShoppingCartSummaryEvent>(processorOptions);

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = newConsumer.start();
          await newConsumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await newConsumer.whenCaughtUp();

          const summary = await summaries.findOne({ _id: streamName });

          assertDeepEqual(summary, {
            _id: streamName,
            status: 'confirmed',
            _version: 2n, // because it captures the whole batch of events as one operation
            productItemsCount: productItem.quantity * 3,
          });
        } finally {
          await newConsumer.close();
          await consumerPromise;
        }
      },
    );
  });

  void describe('created by the event store', () => {
    void it(
      'catches up with events appended before it was started',
      withDeadline,
      async () => {
        // Given
        const shoppingCartId = `shoppingCart:${uuid()}`;
        const streamName = `shopping_cart-${shoppingCartId}`;
        const events: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
        ];
        await eventStore.appendToStream(streamName, events);

        // When
        const consumer = eventStore.consumer();
        consumer.projector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();

          await consumer.whenCaughtUp();

          const summary = await summaries.findOne({ _id: streamName });

          assertMatches(summary, {
            _id: streamName,
            status: 'confirmed',
            productItemsCount: productItem.quantity,
          });
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'leaves the event store usable after it was closed',
      withDeadline,
      async () => {
        // Given
        const store = getPostgreSQLEventStore(connectionString);
        const shoppingCartId = `shoppingCart:${uuid()}`;
        const streamName = `shopping_cart-${shoppingCartId}`;

        const consumer = store.consumer();
        consumer.reactor<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          eachMessage: () => {},
        });

        // When
        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();
        } finally {
          await consumer.close();
          await consumerPromise;
        }

        // Then
        await store.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { productItem } },
        ] as ShoppingCartSummaryEvent[]);

        const { events, streamExists } =
          await store.readStream<ShoppingCartSummaryEvent>(streamName);

        assertTrue(streamExists);
        assertEqual(events.length, 1);

        await store.close();
      },
    );

    void it('is a separate instance on each call', withDeadline, async () => {
      // Given
      const shoppingCartId = `shoppingCart:${uuid()}`;
      const streamName = `shopping_cart-${shoppingCartId}`;

      const first = eventStore.consumer();
      const second = eventStore.consumer();

      assertNotEqual(first.consumerId, second.consumerId);

      const firstHandled: string[] = [];
      const secondHandled: string[] = [];

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

      // When
      let firstPromise: Promise<void> | undefined;
      let secondPromise: Promise<void> | undefined;
      try {
        firstPromise = first.start();
        secondPromise = second.start();
        await first.whenStarted();
        await second.whenStarted();

        await eventStore.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { productItem } },
        ] as ShoppingCartSummaryEvent[]);

        await first.whenCaughtUp();
        await second.whenCaughtUp();

        assertDeepEqual(firstHandled, ['ProductItemAdded']);
        assertDeepEqual(secondHandled, ['ProductItemAdded']);

        // Then closing the first one leaves the second one consuming
        await first.close();
        await firstPromise;

        await eventStore.appendToStream(streamName, [
          { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
        ] as ShoppingCartSummaryEvent[]);

        await second.whenCaughtUp();

        assertDeepEqual(firstHandled, ['ProductItemAdded']);
        assertDeepEqual(secondHandled, [
          'ProductItemAdded',
          'ShoppingCartConfirmed',
        ]);
      } finally {
        await first.close();
        await second.close();
        await Promise.all([firstPromise, secondPromise]);
      }
    });
  });
});

type ShoppingCartSummary = {
  _id?: string;
  productItemsCount: number;
  status: string;
};

const shoppingCartsSummaryCollectionName = 'shoppingCartsSummary';

export type ShoppingCartSummaryEvent = ProductItemAdded | ShoppingCartConfirmed;

const evolve = (
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
};

const shoppingCartsSummaryProjection = pongoSingleStreamProjection({
  collectionName: shoppingCartsSummaryCollectionName,
  evolve,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    status: 'pending',
    productItemsCount: 0,
  }),
});
