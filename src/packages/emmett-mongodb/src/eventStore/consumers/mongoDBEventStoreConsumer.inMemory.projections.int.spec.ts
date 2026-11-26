import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertMatches,
  assertNotEqual,
  assertOk,
  assertThrowsAsync,
  getInMemoryDatabase,
  inMemoryProjector,
  inMemoryReactor,
  inMemorySingleStreamProjection,
  projections,
  type Closeable,
  type InMemoryDocumentsCollection,
  type ProcessorCheckpoint,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import {
  sharedMongoDBDatabase,
  type SharedMongoDBDatabase,
} from '../../testing/sharedMongoDBDatabase';
import type {
  ProductItemAdded,
  ShoppingCartConfirmed,
} from '../../testing/shoppingCart.domain';
import {
  getMongoDBEventStore,
  type MongoDBEventStore,
} from '../mongoDBEventStore';
import { mongoDBInlineProjection } from '../projections';
import { mongoDBEventStoreConsumer } from './mongoDBEventStoreConsumer';

const withDeadline = { timeout: 30000 };

void describe('mongoDB event store started consumer', () => {
  let sharedDatabase: SharedMongoDBDatabase;
  let connectionString: string;
  let eventStore: MongoDBEventStore & Closeable;
  let summaries: InMemoryDocumentsCollection<ShoppingCartSummary>;
  const productItem = { price: 10, productId: uuid(), quantity: 10 };
  const confirmedAt = new Date();
  const database = getInMemoryDatabase();

  beforeAll(() => {
    sharedDatabase = sharedMongoDBDatabase();
    connectionString = sharedDatabase.connectionString;
    eventStore = getMongoDBEventStore({
      connectionString,
      clientOptions: { directConnection: true },
    });
    summaries = database.collection(shoppingCartsSummaryCollectionName);
  });

  afterAll(async () => {
    try {
      await eventStore.close();
      await sharedDatabase.close();
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
        const capturingConsumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [
            inMemoryReactor<ShoppingCartSummaryEvent>({
              processorId: uuid(),
              eachMessage: (event) => {
                if (event.metadata.streamName !== streamName) return;
                startCheckpoint = event.metadata
                  .checkpoint as ProcessorCheckpoint;
              },
            }),
          ],
        });

        let capturingPromise: Promise<void> | undefined;
        try {
          capturingPromise = capturingConsumer.start();
          await capturingConsumer.whenCaughtUp();
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

  void describe('created by the event store', () => {
    void it(
      'catches up with events appended BEFORE it was started',
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
        const consumer = eventStore.consumer<ShoppingCartSummaryEvent>({
          processors: [
            inMemoryProjector<ShoppingCartSummaryEvent>({
              processorId: uuid(),
              projection: shoppingCartsSummaryProjection,
              connectionOptions: { database },
              stopAfter: (event) =>
                event.metadata.streamName === streamName &&
                event.metadata.streamPosition ===
                  appendResult.nextExpectedStreamVersion,
            }),
          ],
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
      'BORROWS the event store connection, so closing it keeps the store usable',
      withDeadline,
      async () => {
        // Given
        const ownEventStore = getMongoDBEventStore({
          connectionString,
          clientOptions: { directConnection: true },
        });
        const shoppingCartId = `shoppingCart:${uuid()}`;
        const streamName = `shopping_cart-${shoppingCartId}`;
        const appendResult = await ownEventStore.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { productItem } },
        ]);

        const consumer = ownEventStore.consumer<ShoppingCartSummaryEvent>({
          processors: [
            inMemoryReactor<ShoppingCartSummaryEvent>({
              processorId: uuid(),
              stopAfter: (event) =>
                event.metadata.streamName === streamName &&
                event.metadata.streamPosition ===
                  appendResult.nextExpectedStreamVersion,
              eachMessage: () => {},
            }),
          ],
        });

        // When
        await consumer.start();
        await consumer.close();

        // Then
        await ownEventStore.appendToStream(streamName, [
          { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
        ]);
        const { events } = await ownEventStore.readStream(streamName);

        assertEqual(events.length, 2);

        await ownEventStore.close();

        await assertThrowsAsync(() => ownEventStore.readStream(streamName));
      },
    );

    void it(
      'returns INDEPENDENT consumers on each call',
      withDeadline,
      async () => {
        // Given
        const shoppingCartId = `shoppingCart:${uuid()}`;
        const streamName = `shopping_cart-${shoppingCartId}`;

        const first: ShoppingCartSummaryEvent[] = [];
        const second: ShoppingCartSummaryEvent[] = [];

        const firstConsumer = eventStore.consumer<ShoppingCartSummaryEvent>({
          processors: [
            inMemoryReactor<ShoppingCartSummaryEvent>({
              processorId: uuid(),
              eachMessage: (event) => {
                if (event.metadata.streamName !== streamName) return;
                first.push(event);
              },
            }),
          ],
        });
        const secondConsumer = eventStore.consumer<ShoppingCartSummaryEvent>({
          processors: [
            inMemoryReactor<ShoppingCartSummaryEvent>({
              processorId: uuid(),
              eachMessage: (event) => {
                if (event.metadata.streamName !== streamName) return;
                second.push(event);
              },
            }),
          ],
        });

        assertFalse(firstConsumer === secondConsumer);
        assertNotEqual(firstConsumer.consumerId, secondConsumer.consumerId);

        // When
        let firstPromise: Promise<void> | undefined;
        let secondPromise: Promise<void> | undefined;
        try {
          firstPromise = firstConsumer.start();
          secondPromise = secondConsumer.start();
          await Promise.all([
            firstConsumer.whenStarted(),
            secondConsumer.whenStarted(),
          ]);

          await eventStore.appendToStream(streamName, [
            { type: 'ProductItemAdded', data: { productItem } },
          ]);
          await Promise.all([
            firstConsumer.whenCaughtUp(),
            secondConsumer.whenCaughtUp(),
          ]);

          assertEqual(first.length, 1);
          assertEqual(second.length, 1);

          // Then closing the first one doesn't stop the second one
          await firstConsumer.close();
          await firstPromise;
          firstPromise = undefined;

          await eventStore.appendToStream(streamName, [
            { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
          ]);
          await secondConsumer.whenCaughtUp();

          assertEqual(first.length, 1);
          assertEqual(second.length, 2);
        } finally {
          await firstConsumer.close();
          await firstPromise;
          await secondConsumer.close();
          await secondPromise;
        }
      },
    );
  });

  void it(
    `in-memory reactor appends through the session's message store`,
    withDeadline,
    async () => {
      const streamName = `shopping_cart-shoppingCart:${uuid()}`;
      const orderStreamName = `order-${uuid()}`;
      await eventStore.appendToStream(streamName, [
        { type: 'ProductItemAdded', data: { productItem } },
      ] as ProductItemAdded[]);

      const inMemoryProcessor = inMemoryReactor<ProductItemAdded>({
        processorId: uuid(),
        eachMessage: async (message, context) => {
          if (message.metadata.streamName !== streamName) return;

          const messageStore = context.session.messageStore;
          await messageStore.appendToStream(orderStreamName, [
            {
              type: 'ProductItemAdded',
              data: { productItem: message.data.productItem },
            },
          ]);
        },
        stopAfter: (event) =>
          event.metadata.streamName === streamName &&
          event.metadata.streamPosition === 1n,
      });

      const consumer = mongoDBEventStoreConsumer({
        connectionString,
        clientOptions: { directConnection: true },
        processors: [inMemoryProcessor],
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      const {
        events: [handled],
      } = await eventStore.readStream<ProductItemAdded>(streamName);
      const { events } =
        await eventStore.readStream<ProductItemAdded>(orderStreamName);
      assertOk(handled);
      assertDeepEqual(
        events.map(({ type, kind, schemaVersion, data, metadata }) => ({
          type,
          kind,
          schemaVersion,
          data,
          streamName: metadata.streamName,
          streamPosition: metadata.streamPosition,
          correlationId: metadata.correlationId,
          causationId: metadata.causationId,
        })),
        [
          {
            type: 'ProductItemAdded',
            kind: 'Event',
            schemaVersion: 1,
            data: { productItem },
            streamName: orderStreamName,
            streamPosition: 1n,
            correlationId: handled.metadata.correlationId,
            causationId: handled.metadata.messageId,
          },
        ],
      );
    },
  );
  void it(
    `in-memory reactor on the event store's consumer appends through that event store`,
    withDeadline,
    async () => {
      const streamName = `shopping_cart-shoppingCart:${uuid()}`;
      const orderStreamName = `order-${uuid()}`;
      await eventStore.appendToStream(streamName, [
        { type: 'ProductItemAdded', data: { productItem } },
      ] as ProductItemAdded[]);
      const inlineProjected: ReadEvent<ProductItemAdded>[] = [];
      const storeWithInlineProjection = getMongoDBEventStore({
        connectionString,
        clientOptions: { directConnection: true },
        projections: projections.inline([
          mongoDBInlineProjection<{ count: number }, ProductItemAdded>({
            name: `orders-${uuid()}`,
            canHandle: ['ProductItemAdded'],
            initialState: () => ({ count: 0 }),
            evolve: (
              document: { count: number },
              event: ReadEvent<ProductItemAdded>,
            ) => {
              inlineProjected.push(event);
              return { count: document.count + 1 };
            },
          }),
        ]),
      });

      const inMemoryProcessor = inMemoryReactor<ProductItemAdded>({
        processorId: uuid(),
        eachMessage: async (message, context) => {
          if (message.metadata.streamName !== streamName) return;

          await context.session.messageStore.appendToStream(orderStreamName, [
            {
              type: 'ProductItemAdded',
              data: { productItem: message.data.productItem },
            },
          ]);
        },
        stopAfter: (event) =>
          event.metadata.streamName === streamName &&
          event.metadata.streamPosition === 1n,
      });

      const consumer = storeWithInlineProjection.consumer({
        processors: [inMemoryProcessor],
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
        await storeWithInlineProjection.close();
      }

      const {
        events: [stored],
      } = await eventStore.readStream<ProductItemAdded>(orderStreamName);
      assertOk(stored);
      assertDeepEqual(inlineProjected, [
        {
          type: 'ProductItemAdded',
          kind: 'Event',
          schemaVersion: 1,
          data: { productItem },
          metadata: {
            streamName: orderStreamName,
            streamPosition: 1n,
            messageId: stored.metadata.messageId,
            correlationId: stored.metadata.correlationId,
            causationId: stored.metadata.causationId,
            traceId: stored.metadata.traceId,
            spanId: stored.metadata.spanId,
          },
        },
      ]);
    },
  );
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
