import {
  assertDeepEqual,
  assertMatches,
  assertOk,
  getInMemoryDatabase,
  inMemoryProjector,
  inMemoryReactor,
  inMemorySingleStreamProjection,
  projections,
  type InMemoryDocumentsCollection,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../testing/postgreSQLTestDatabase';
import type {
  ProductItemAdded,
  ShoppingCartConfirmed,
} from '../../testing/shoppingCart.domain';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import { postgreSQLEventStoreConsumer } from './postgreSQLEventStoreConsumer';
import { pgEventStoreDriver } from '../../pg';
import { postgreSQLProjection } from '../projections';

const withDeadline = { timeout: 30000 };

void describe('PostgreSQL event store started consumer', () => {
  let postgresDatabase: PostgreSQLTestDatabase;
  let connectionString: string;
  let eventStore: PostgresEventStore;
  let summaries: InMemoryDocumentsCollection<ShoppingCartSummary>;
  const productItem = { price: 10, productId: uuid(), quantity: 10 };
  const confirmedAt = new Date();
  const database = getInMemoryDatabase();

  beforeAll(async () => {
    postgresDatabase = await sharedPostgreSQLDatabase();
    connectionString = postgresDatabase.connectionString;
    eventStore = getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString: connectionString,
    });
    summaries = database.collection(shoppingCartsSummaryCollectionName);
    await eventStore.schema.migrate();
  });

  afterAll(async () => {
    try {
      await eventStore?.close();
      await postgresDatabase?.close();
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
            event.metadata.globalPosition ===
            appendResult.lastEventGlobalPosition,
        });

        // When
        const consumer = postgreSQLEventStoreConsumer<ShoppingCartSummaryEvent>(
          {
            connectionString,
            processors: [inMemoryProcessor],
          },
        );

        try {
          await consumer.start();

          const summary = await summaries.findOne((d) => d._id === streamName);

          assertMatches(summary, {
            _id: streamName,
            status: 'confirmed',
            // TODO: ensure that _version and _id works like in Pongo
            //_version: 2n,
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
        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database },
        });
        const consumer = postgreSQLEventStoreConsumer<ShoppingCartSummaryEvent>(
          {
            connectionString,
            processors: [inMemoryProcessor],
          },
        );

        // When
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
            //_version: 2n,
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

        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database },
          startFrom: {
            lastCheckpoint: startPosition,
          },
        });

        const consumer = postgreSQLEventStoreConsumer<ShoppingCartSummaryEvent>(
          {
            connectionString,
            processors: [inMemoryProcessor],
          },
        );

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
            //_version: 2n,
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

        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database },
          startFrom: 'CURRENT',
        });

        const consumer = postgreSQLEventStoreConsumer<ShoppingCartSummaryEvent>(
          {
            connectionString,
            processors: [inMemoryProcessor],
          },
        );

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
            // _version: 4n,
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

        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database },
          startFrom: 'CURRENT',
          stopAfter: (event) => event.metadata.globalPosition === startPosition,
        });

        const consumer = postgreSQLEventStoreConsumer<ShoppingCartSummaryEvent>(
          {
            connectionString,
            processors: [inMemoryProcessor],
          },
        );

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
            //_version: 4n,
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

        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database },
          startFrom: 'CURRENT',
          stopAfter: (event) => event.metadata.globalPosition === startPosition,
        });

        const consumer = postgreSQLEventStoreConsumer<ShoppingCartSummaryEvent>(
          {
            connectionString,
            processors: [inMemoryProcessor],
          },
        );

        // When
        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }

        const newConsumer = postgreSQLEventStoreConsumer({
          connectionString,
          processors: [inMemoryProcessor],
        });

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
            _version: 4n,
            productItemsCount: productItem.quantity * 3,
          });
        } finally {
          await newConsumer.close();
          await consumerPromise;
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
      const { lastEventGlobalPosition } = await eventStore.appendToStream(
        streamName,
        [
          { type: 'ProductItemAdded', data: { productItem } },
        ] as ProductItemAdded[],
      );

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
          event.metadata.globalPosition === lastEventGlobalPosition,
      });

      const consumer = postgreSQLEventStoreConsumer({
        connectionString,
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
          isAfterHandled:
            metadata.globalPosition > handled.metadata.globalPosition,
          isCheckpointAtGlobalPosition:
            metadata.checkpoint === metadata.globalPosition,
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
            isAfterHandled: true,
            isCheckpointAtGlobalPosition: true,
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
      const { lastEventGlobalPosition } = await eventStore.appendToStream(
        streamName,
        [
          { type: 'ProductItemAdded', data: { productItem } },
        ] as ProductItemAdded[],
      );
      const inlineProjected: ReadEvent<ProductItemAdded>[] = [];
      const storeWithInlineProjection = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString,
        projections: projections.inline([
          postgreSQLProjection<ProductItemAdded>({
            name: `orders-${uuid()}`,
            canHandle: ['ProductItemAdded'],
            handle: (events) => {
              inlineProjected.push(...events);
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
          event.metadata.globalPosition === lastEventGlobalPosition,
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
            globalPosition: stored.metadata.globalPosition,
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
