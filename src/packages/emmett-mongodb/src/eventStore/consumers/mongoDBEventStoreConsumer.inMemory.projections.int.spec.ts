import {
  assertMatches,
  getInMemoryDatabase,
  inMemoryProjector,
  inMemorySingleStreamProjection,
  type Closeable,
  type InMemoryDocumentsCollection,
  type ReadEvent,
} from '@event-driven-io/emmett';
import {
  MongoDBContainer,
  type StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import { after, before, describe, it } from 'node:test';
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

const withDeadline = { timeout: 30000 };

void describe.skip('mongoDB event store started consumer', () => {
  let mongoDB: StartedMongoDBContainer;
  let connectionString: string;
  let eventStore: MongoDBEventStore & Closeable;
  let summaries: InMemoryDocumentsCollection<ShoppingCartSummary>;
  const productItem = { price: 10, productId: uuid(), quantity: 10 };
  const confirmedAt = new Date();
  const database = getInMemoryDatabase();

  before(async () => {
    mongoDB = await new MongoDBContainer('mongo:6.0.1').start();
    connectionString = mongoDB.getConnectionString();
    eventStore = getMongoDBEventStore({
      connectionString: mongoDB.getConnectionString(),
      clientOptions: { directConnection: true },
    });
    summaries = database.collection(shoppingCartsSummaryCollectionName);
  });

  after(async () => {
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
        const shoppingCartId = `shoppingCart:${uuid()}`;
        const streamName = `shopping_cart-${shoppingCartId}`;
        let stopAfterPosition: bigint | undefined = undefined;

        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database },
          stopAfter: (event) =>
            event.metadata.streamName === streamName &&
            event.metadata.streamPosition === stopAfterPosition,
        });
        const consumer = mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [inMemoryProcessor],
        });

        // When
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

        try {
          const consumerPromise = consumer.start();

          const appendResult = await eventStore.appendToStream(
            streamName,
            events,
          );
          stopAfterPosition = appendResult.nextExpectedStreamVersion;

          await consumerPromise;

          const summary = await summaries.findOne((d) => d._id === streamName);

          assertMatches(summary, {
            _id: streamName,
            status: 'confirmed',
            //_version: 2n,
            productItemsCount: productItem.quantity,
          });
        } finally {
          await consumer.close();
        }
      },
    );

    // void it(
    //   'handles ONLY events AFTER provided global position',
    //   withDeadline,
    //   async () => {
    //     // Given
    //     const shoppingCartId = `shoppingCart:${uuid()}`;
    //     const streamName = `shopping_cart-${shoppingCartId}`;

    //     const initialEvents: ShoppingCartSummaryEvent[] = [
    //       { type: 'ProductItemAdded', data: { productItem } },
    //       { type: 'ProductItemAdded', data: { productItem } },
    //     ];
    //     const { nextExpectedStreamVersion } = await eventStore.appendToStream(
    //       streamName,
    //       initialEvents,
    //     );

    //     const events: ShoppingCartSummaryEvent[] = [
    //       { type: 'ProductItemAdded', data: { productItem } },
    //       {
    //         type: 'ShoppingCartConfirmed',
    //         data: { confirmedAt },
    //       },
    //     ];

    //     let stopAfterPosition: bigint | undefined = nextExpectedStreamVersion;
    //     let checkpoint: MongoDBCheckpoint | null | undefined = undefined;

    //     const projectorOptions: InMemoryProjectorOptions<ShoppingCartSummaryEvent> =
    //       {
    //         processorId: uuid(),
    //         projection: shoppingCartsSummaryProjection,
    //         connectionOptions: { database },
    //         stopAfter: (event) => {
    //           checkpoint = getCheckpoint(event);
    //           return (
    //             event.metadata.streamName === streamName &&
    //             event.metadata.streamPosition === stopAfterPosition
    //           );
    //         },
    //       };

    //     let eartlierConsumer: MongoDBEventStoreConsumer<ShoppingCartSummaryEvent> =
    //       undefined!;

    //     try {
    //       eartlierConsumer =
    //         mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
    //           connectionString,
    //           clientOptions: { directConnection: true },
    //           processors: [
    //             inMemoryProjector<ShoppingCartSummaryEvent>(projectorOptions),
    //           ],
    //         });

    //       await eartlierConsumer.start();
    //     } finally {
    //       await eartlierConsumer.close();
    //     }

    //     // When
    //     let consumer: MongoDBEventStoreConsumer<ShoppingCartSummaryEvent> =
    //       undefined!;

    //     try {
    //       consumer = mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
    //         connectionString,
    //         clientOptions: { directConnection: true },
    //         processors: [
    //           inMemoryProjector<ShoppingCartSummaryEvent>({
    //             ...projectorOptions,
    //             startFrom: checkpoint,
    //           }),
    //         ],
    //       });
    //       stopAfterPosition = undefined;
    //       const consumerPromise = consumer.start();

    //       const appendResult = await eventStore.appendToStream(
    //         streamName,
    //         events,
    //       );
    //       stopAfterPosition = appendResult.nextExpectedStreamVersion;

    //       await consumerPromise;

    //       const summary = await summaries.findOne((d) => d._id === streamName);

    //       assertMatches(summary, {
    //         _id: streamName,
    //         status: 'confirmed',
    //         _version: 3n,
    //         productItemsCount: productItem.quantity,
    //       });
    //     } finally {
    //       await consumer.close();
    //     }
    //   },
    // );

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

        let stopAfterPosition: bigint | undefined = undefined;

        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database },
          startFrom: 'CURRENT',
          stopAfter: (event) =>
            event.metadata.streamName === streamName &&
            event.metadata.streamPosition === stopAfterPosition,
        });

        const consumer = mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [inMemoryProcessor],
        });

        // When

        try {
          const consumerPromise = consumer.start();

          const appendResult = await eventStore.appendToStream(
            streamName,
            events,
          );
          stopAfterPosition = appendResult.nextExpectedStreamVersion;

          await consumerPromise;

          const summary = await summaries.findOne((d) => d._id === streamName);

          assertMatches(summary, {
            _id: streamName,
            status: 'confirmed',
            // _version: 4n,
            productItemsCount: productItem.quantity * 3,
          });
        } finally {
          await consumer.close();
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
        const { nextExpectedStreamVersion } = await eventStore.appendToStream(
          streamName,
          initialEvents,
        );

        const events: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          {
            type: 'ShoppingCartConfirmed',
            data: { confirmedAt },
          },
        ];

        let stopAfterPosition: bigint | undefined = nextExpectedStreamVersion;

        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database },
          startFrom: 'CURRENT',
          stopAfter: (event) =>
            event.metadata.streamName === streamName &&
            event.metadata.streamPosition === stopAfterPosition,
        });

        const consumer = mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [inMemoryProcessor],
        });

        // When
        await consumer.start();
        await consumer.stop();

        stopAfterPosition = undefined;

        try {
          const appendResult = await eventStore.appendToStream(
            streamName,
            events,
          );
          stopAfterPosition = appendResult.nextExpectedStreamVersion;
          console.log('stopAfterPosition', stopAfterPosition);

          const consumerPromise = consumer.start();

          await consumerPromise;

          const summary = await summaries.findOne((d) => d._id === streamName);

          assertMatches(summary, {
            _id: streamName,
            status: 'confirmed',
            //_version: 4n,
            productItemsCount: productItem.quantity * 3,
          });
        } finally {
          await consumer.close();
        }
      },
    );

    // void it(
    //   'handles only new events when CURRENT position is stored for a new consumer',
    //   withDeadline,
    //   async () => {
    //     // Given
    //     const shoppingCartId = `shoppingCart:${uuid()}`;
    //     const streamName = `shopping_cart-${shoppingCartId}`;

    //     const initialEvents: ShoppingCartSummaryEvent[] = [
    //       { type: 'ProductItemAdded', data: { productItem } },
    //       { type: 'ProductItemAdded', data: { productItem } },
    //     ];
    //     const { nextExpectedStreamVersion } = await eventStore.appendToStream(
    //       streamName,
    //       initialEvents,
    //     );

    //     const events: ShoppingCartSummaryEvent[] = [
    //       { type: 'ProductItemAdded', data: { productItem } },
    //       {
    //         type: 'ShoppingCartConfirmed',
    //         data: { confirmedAt },
    //       },
    //     ];

    //     let stopAfterPosition: bigint | undefined = nextExpectedStreamVersion;

    //     const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
    //       processorId: uuid(),
    //       projection: shoppingCartsSummaryProjection,
    //       connectionOptions: { database },
    //       startFrom: 'CURRENT',
    //       stopAfter: (event) =>
    //         event.metadata.streamName === streamName &&
    //         event.metadata.streamPosition === stopAfterPosition,
    //     });

    //     const consumer = mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
    //       connectionString,
    //       clientOptions: { directConnection: true },
    //       processors: [inMemoryProcessor],
    //     });

    //     // When
    //     try {
    //       await consumer.start();
    //     } finally {
    //       await consumer.close();
    //     }

    //     stopAfterPosition = undefined;

    //     const newConsumer = mongoDBEventStoreConsumer({
    //       connectionString,
    //       clientOptions: { directConnection: true },
    //       processors: [inMemoryProcessor],
    //     });

    //     try {
    //       const consumerPromise = newConsumer.start();

    //       const appendResult = await eventStore.appendToStream(
    //         streamName,
    //         events,
    //       );
    //       stopAfterPosition = appendResult.nextExpectedStreamVersion;

    //       await consumerPromise;

    //       const summary = await summaries.findOne((d) => d._id === streamName);

    //       assertMatches(summary, {
    //         _id: streamName,
    //         status: 'confirmed',
    //         //_version: 4n,
    //         productItemsCount: productItem.quantity * 3,
    //       });
    //     } finally {
    //       await newConsumer.close();
    //     }
    //   },
    // );
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
