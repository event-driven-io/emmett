import {
  assertDeepEqual,
  bigIntProcessorCheckpoint,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import {
  pongoClient,
  type PongoClient,
  type PongoCollection,
} from '@event-driven-io/pongo';
import { pgDriver } from '@event-driven-io/pongo/pg';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
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
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let eventStore: PostgresEventStore;
  let pongo: PongoClient;
  let summaries: PongoCollection<ShoppingCartSummary>;
  const productItem = { price: 10, productId: uuid(), quantity: 10 };
  const confirmedAt = new Date();

  before(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();
    eventStore = getPostgreSQLEventStore(connectionString);
    pongo = pongoClient({ connectionString, driver: pgDriver });
    summaries = pongo.db().collection(shoppingCartsSummaryCollectionName);
    await eventStore.schema.migrate();
  });

  after(async () => {
    try {
      await eventStore.close();
      await pongo.close();
      await postgres.stop();
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
            _version: 2n,
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
        let stopAfterPosition: bigint | undefined = undefined;

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        consumer.projector({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          stopAfter: (event) =>
            event.metadata.globalPosition === stopAfterPosition,
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

        try {
          const consumerPromise = consumer.start();

          const appendResult = await eventStore.appendToStream(
            streamName,
            events,
          );
          stopAfterPosition = appendResult.lastEventGlobalPosition;

          await consumerPromise;

          const summary = await summaries.findOne({ _id: streamName });

          assertDeepEqual(summary, {
            _id: streamName,
            status: 'confirmed',
            _version: 2n,
            productItemsCount: productItem.quantity,
          });
        } finally {
          await consumer.close();
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

        let stopAfterPosition: bigint | undefined = undefined;

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        consumer.projector({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          startFrom: {
            lastCheckpoint: bigIntProcessorCheckpoint(startPosition),
          },
          stopAfter: (event) =>
            event.metadata.globalPosition === stopAfterPosition,
        });

        try {
          const consumerPromise = consumer.start();

          const appendResult = await eventStore.appendToStream(
            streamName,
            events,
          );
          stopAfterPosition = appendResult.lastEventGlobalPosition;

          await consumerPromise;

          const summary = await summaries.findOne({ _id: streamName });

          assertDeepEqual(summary, {
            _id: streamName,
            status: 'confirmed',
            _version: 2n,
            productItemsCount: productItem.quantity,
          });
        } finally {
          await consumer.close();
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

        let stopAfterPosition: bigint | undefined = undefined;

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        consumer.projector({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          startFrom: 'CURRENT',
          stopAfter: (event) =>
            event.metadata.globalPosition === stopAfterPosition,
        });

        try {
          const consumerPromise = consumer.start();

          const appendResult = await eventStore.appendToStream(
            streamName,
            events,
          );
          stopAfterPosition = appendResult.lastEventGlobalPosition;

          await consumerPromise;

          const summary = await summaries.findOne({ _id: streamName });

          assertDeepEqual(summary, {
            _id: streamName,
            status: 'confirmed',
            _version: 4n,
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
        const { lastEventGlobalPosition } = await eventStore.appendToStream(
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

        let stopAfterPosition: bigint | undefined = lastEventGlobalPosition;

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        consumer.projector({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          startFrom: 'CURRENT',
          stopAfter: (event) =>
            event.metadata.globalPosition === stopAfterPosition,
        });

        await consumer.start();
        await consumer.stop();

        stopAfterPosition = undefined;

        try {
          const consumerPromise = consumer.start();

          const appendResult = await eventStore.appendToStream(
            streamName,
            events,
          );
          stopAfterPosition = appendResult.lastEventGlobalPosition;

          await consumerPromise;

          const summary = await summaries.findOne({ _id: streamName });

          assertDeepEqual(summary, {
            _id: streamName,
            status: 'confirmed',
            _version: 4n,
            productItemsCount: productItem.quantity * 3,
          });
        } finally {
          await consumer.close();
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
        const { lastEventGlobalPosition } = await eventStore.appendToStream(
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

        let stopAfterPosition: bigint | undefined = lastEventGlobalPosition;

        const processorOptions: PostgreSQLProjectorOptions<ShoppingCartSummaryEvent> =
          {
            processorId: uuid(),
            projection: shoppingCartsSummaryProjection,
            startFrom: 'CURRENT',
            stopAfter: (event) =>
              event.metadata.globalPosition === stopAfterPosition,
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

        stopAfterPosition = undefined;

        const newConsumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        newConsumer.projector<ShoppingCartSummaryEvent>(processorOptions);

        try {
          const consumerPromise = newConsumer.start();

          const appendResult = await eventStore.appendToStream(
            streamName,
            events,
          );
          stopAfterPosition = appendResult.lastEventGlobalPosition;

          await consumerPromise;

          const summary = await summaries.findOne({ _id: streamName });

          assertDeepEqual(summary, {
            _id: streamName,
            status: 'confirmed',
            _version: 4n,
            productItemsCount: productItem.quantity * 3,
          });
        } finally {
          await newConsumer.close();
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

const shoppingCartsSummaryProjection = pongoSingleStreamProjection({
  collectionName: shoppingCartsSummaryCollectionName,
  evolve,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    status: 'pending',
    productItemsCount: 0,
  }),
});
