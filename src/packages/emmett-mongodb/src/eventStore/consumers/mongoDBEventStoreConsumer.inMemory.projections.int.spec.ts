import {
  assertMatches,
  asyncAwaiter,
  getInMemoryDatabase,
  inMemoryProjector,
  inMemoryReactor,
  inMemorySingleStreamProjection,
  type Closeable,
  type InMemoryDocumentsCollection,
  type ProcessorCheckpoint,
  type ReadEvent,
} from '@event-driven-io/emmett';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import type {
  ProductItemAdded,
  ShoppingCartConfirmed,
} from '../../testing/shoppingCart.domain';
import {
  getMongoDBEventStore,
  type MongoDBEventStore,
} from '../mongoDBEventStore';
import { mongoDBEventStoreConsumer } from './mongoDBEventStoreConsumer';
import { getMongoDBStartedContainer } from '@event-driven-io/emmett-testcontainers';
import { compareTwoMongoDBCheckpoints } from './subscriptions';

const withDeadline = { timeout: 30000 };

/**
 * MongoDB checkpoints are resume tokens, not lexicographically ordered values,
 * so processors must compare them via the MongoDB-specific comparator.
 */
const compareCheckpoints = compareTwoMongoDBCheckpoints as (
  a: ProcessorCheckpoint,
  b: ProcessorCheckpoint,
) => number;

void describe('mongoDB event store started consumer', () => {
  let mongoDB: StartedMongoDBContainer;
  let connectionString: string;
  let eventStore: MongoDBEventStore & Closeable;
  let summaries: InMemoryDocumentsCollection<ShoppingCartSummary>;
  const productItem = { price: 10, productId: uuid(), quantity: 10 };
  const confirmedAt = new Date();
  const database = getInMemoryDatabase();

  beforeAll(async () => {
    mongoDB = await getMongoDBStartedContainer();
    connectionString = mongoDB.getConnectionString();
    eventStore = getMongoDBEventStore({
      connectionString: mongoDB.getConnectionString(),
      clientOptions: { directConnection: true },
    });
    summaries = database.collection(shoppingCartsSummaryCollectionName);
  });

  afterAll(async () => {
    try {
      await eventStore.close();
      await mongoDB.stop();
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

        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database },
          compareCheckpoints,
          stopAfter: (event) =>
            event.metadata.streamName === streamName &&
            event.metadata.streamPosition ===
              appendResult.nextExpectedStreamVersion,
        });

        // When
        const consumer = mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [inMemoryProcessor],
        });

        try {
          await consumer.start();

          const summary = await summaries.findOne((d) => d._id === streamName);

          assertMatches(summary, {
            _id: streamName,
            status: 'confirmed',
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
        const shoppingCartId = `shoppingCart:${uuid()}`;
        const streamName = `shopping_cart-${shoppingCartId}`;

        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database },
          compareCheckpoints,
        });
        const consumer = mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [inMemoryProcessor],
        });

        const events: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
        ];

        // When
        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const summary = await summaries.findOne((d) => d._id === streamName);

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
      'handles ONLY events AFTER provided checkpoint',
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

        // Capture the checkpoint of the last initial event without projecting it,
        // as MongoDB checkpoints are resume tokens that cannot be synthesised.
        let startCheckpoint: ProcessorCheckpoint | undefined;
        let seen = 0;
        const captured = asyncAwaiter();
        const capturingConsumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [
            inMemoryReactor<ShoppingCartSummaryEvent>({
              processorId: uuid(),
              compareCheckpoints,
              eachMessage: (event) => {
                if (event.metadata.streamName !== streamName) return;
                startCheckpoint = event.metadata
                  .checkpoint as ProcessorCheckpoint;
                if (++seen === initialEvents.length) captured.resolve();
              },
            }),
          ],
        });

        let capturingPromise: Promise<void> | undefined;
        try {
          capturingPromise = capturingConsumer.start();
          await capturingConsumer.whenStarted();
          await captured.wait;
        } finally {
          await capturingConsumer.close();
          await capturingPromise;
        }

        const events: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
        ];

        // When
        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database },
          compareCheckpoints,
          startFrom: {
            lastCheckpoint: startCheckpoint as ProcessorCheckpoint,
          },
        });
        const consumer = mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [inMemoryProcessor],
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const summary = await summaries.findOne((d) => d._id === streamName);

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
          { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
        ];

        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database },
          compareCheckpoints,
          startFrom: 'CURRENT',
        });

        const consumer = mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [inMemoryProcessor],
        });

        // When
        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const summary = await summaries.findOne((d) => d._id === streamName);

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
        const { nextExpectedStreamVersion: startPosition } =
          await eventStore.appendToStream(streamName, initialEvents);

        const events: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
        ];

        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database },
          compareCheckpoints,
          startFrom: 'CURRENT',
          stopAfter: (event) =>
            event.metadata.streamName === streamName &&
            event.metadata.streamPosition === startPosition,
        });

        const consumer = mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [inMemoryProcessor],
        });

        // When
        await consumer.start();
        await consumer.stop();

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const summary = await summaries.findOne((d) => d._id === streamName);

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
        const { nextExpectedStreamVersion: startPosition } =
          await eventStore.appendToStream(streamName, initialEvents);

        const events: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
        ];

        const processorId = uuid();
        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId,
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database },
          compareCheckpoints,
          startFrom: 'CURRENT',
          stopAfter: (event) =>
            event.metadata.streamName === streamName &&
            event.metadata.streamPosition === startPosition,
        });

        // When
        const consumer = mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [inMemoryProcessor],
        });
        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }

        const newInMemoryProcessor =
          inMemoryProjector<ShoppingCartSummaryEvent>({
            processorId,
            projection: shoppingCartsSummaryProjection,
            connectionOptions: { database },
            compareCheckpoints,
            startFrom: 'CURRENT',
          });
        const newConsumer = mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>(
          {
            connectionString,
            clientOptions: { directConnection: true },
            processors: [newInMemoryProcessor],
          },
        );

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = newConsumer.start();
          await newConsumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await newConsumer.whenCaughtUp();

          const summary = await summaries.findOne((d) => d._id === streamName);

          assertMatches(summary, {
            _id: streamName,
            status: 'confirmed',
            productItemsCount: productItem.quantity * 3,
          });
        } finally {
          await newConsumer.close();
          await consumerPromise;
        }
      },
    );
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

const shoppingCartsSummaryProjection = inMemorySingleStreamProjection({
  collectionName: shoppingCartsSummaryCollectionName,
  evolve,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    status: 'pending',
    productItemsCount: 0,
  }),
});
