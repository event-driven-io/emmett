import { assertDeepEqual, type ReadEvent } from '@event-driven-io/emmett';
import { before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import { InMemorySQLiteDatabase } from '../../connection';
import type {
  ProductItemAdded,
  ShoppingCartConfirmed,
} from '../../testing/shoppingCart.domain';
import { sqliteRawSQLProjection } from '../projections';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../SQLiteEventStore';
import { sqliteEventStoreConsumer } from './sqliteEventStoreConsumer';
import type { SQLiteProcessorOptions } from './sqliteProcessor';

const withDeadline = { timeout: 5000 };

void describe('SQLite event store started consumer', () => {
  let eventStore: SQLiteEventStore;

  const productItem = { price: 10, productId: uuid(), quantity: 10 };
  const confirmedAt = new Date();

  before(() => {
    eventStore = getSQLiteEventStore({
      fileName: InMemorySQLiteDatabase,
    });
  });

  void describe('eachMessage', () => {
    void it(
      'handles all events appended to event store BEFORE processor was started',
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
        const consumer = sqliteEventStoreConsumer({
          fileName: InMemorySQLiteDatabase,
        });
        consumer.processor({
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
      'handles all events appended to event store AFTER processor was started',
      withDeadline,
      async () => {
        // Given
        let stopAfterPosition: bigint | undefined = undefined;

        // When
        const consumer = sqliteEventStoreConsumer({
          fileName: InMemorySQLiteDatabase,
        });
        consumer.processor({
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
        const consumer = sqliteEventStoreConsumer({
          fileName: InMemorySQLiteDatabase,
        });
        consumer.processor({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          startFrom: { globalPosition: startPosition },
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
        const consumer = sqliteEventStoreConsumer({
          fileName: InMemorySQLiteDatabase,
        });
        consumer.processor({
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
        const consumer = sqliteEventStoreConsumer({
          fileName: InMemorySQLiteDatabase,
        });
        consumer.processor({
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

        const processorOptions: SQLiteProcessorOptions<ShoppingCartSummaryEvent> =
          {
            processorId: uuid(),
            projection: shoppingCartsSummaryProjection,
            startFrom: 'CURRENT',
            stopAfter: (event) =>
              event.metadata.globalPosition === stopAfterPosition,
          };

        // When
        const consumer = sqliteEventStoreConsumer({
          fileName: InMemorySQLiteDatabase,
        });
        try {
          consumer.processor<ShoppingCartSummaryEvent>(processorOptions);

          await consumer.start();
        } finally {
          await consumer.close();
        }

        stopAfterPosition = undefined;

        const newConsumer = sqliteEventStoreConsumer({
          fileName: InMemorySQLiteDatabase,
        });
        newConsumer.processor<ShoppingCartSummaryEvent>(processorOptions);

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

const shoppingCartsSummaryProjection = sqliteRawSQLProjection({
  evolve,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    status: 'pending',
    productItemsCount: 0,
  }),
});
