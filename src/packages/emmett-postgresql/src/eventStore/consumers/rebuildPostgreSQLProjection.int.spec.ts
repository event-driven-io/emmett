import {
  assertDeepEqual,
  projections,
  type ReadEvent,
} from '@event-driven-io/emmett';
import {
  pongoClient,
  type PongoClient,
  type PongoCollection,
} from '@event-driven-io/pongo';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import type {
  ProductItemAdded,
  ShoppingCartConfirmed,
} from '../../testing/shoppingCart.domain';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import { pongoSingleStreamProjection } from '../projections';
import { rebuildPostgreSQLProjection } from './rebuildPostgreSQLProjection';

const withDeadline = { timeout: 5000000 };

void describe('PostgreSQL event store started consumer', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let eventStore: PostgresEventStore;
  let pongo: PongoClient;
  let summaries: PongoCollection<ShoppingCartSummary>;
  const productItem = { price: 10, productId: uuid(), quantity: 10 };
  const confirmedAt = new Date();

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    connectionString = postgres.getConnectionUri();
    eventStore = getPostgreSQLEventStore(connectionString, {
      projections: projections.inline([shoppingCartsSummaryProjection]),
    });
    pongo = pongoClient(connectionString);
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
      'handles all events appended to event store BEFORE processor was started',
      withDeadline,
      async () => {
        // Given
        const shoppingCartId = `shoppingCart:${uuid()}`;
        const otherShoppingCartId = `shoppingCart:${uuid()}`;

        const streamName = `shopping_cart-${shoppingCartId}`;
        const otherStreamName = `shopping_cart-${otherShoppingCartId}`;

        const events: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
        ];

        await eventStore.appendToStream(streamName, events);
        await eventStore.appendToStream(otherStreamName, events);

        let summary = await summaries.findOne({ _id: streamName });
        let otherSummary = await summaries.findOne({ _id: otherStreamName });

        assertDeepEqual(summary, {
          _id: streamName,
          status: 'confirmed',
          _version: 2n,
          productItemsCount: productItem.quantity,
        });
        assertDeepEqual(otherSummary, {
          _id: otherStreamName,
          status: 'confirmed',
          _version: 2n,
          productItemsCount: productItem.quantity,
        });

        // When
        const consumer = rebuildPostgreSQLProjection({
          connectionString,
          projection: shoppingCartsSummaryProjectionV2,
        });

        try {
          await consumer.start();

          summary = await summaries.findOne({ _id: streamName });
          otherSummary = await summaries.findOne({ _id: otherStreamName });

          assertDeepEqual(summary, {
            _id: streamName,
            status: 'confirmed',
            _version: 2n,
            productItemsCount: productItem.quantity * v2QuantityMultiplier,
          });
          assertDeepEqual(otherSummary, {
            _id: otherStreamName,
            status: 'confirmed',
            _version: 2n,
            productItemsCount: productItem.quantity * v2QuantityMultiplier,
          });
        } finally {
          await consumer.close();
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

const v2QuantityMultiplier = 1.76;

const evolveV2 = (
  document: ShoppingCartSummary,
  { type, data }: ReadEvent<ShoppingCartSummaryEvent>,
): ShoppingCartSummary => {
  switch (type) {
    case 'ProductItemAdded':
      return {
        ...document,
        productItemsCount:
          // Multiply the quantity of product items to show differenece between v1 and v2
          document.productItemsCount +
          data.productItem.quantity * v2QuantityMultiplier,
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

const shoppingCartsSummaryProjectionV2 = pongoSingleStreamProjection({
  collectionName: shoppingCartsSummaryCollectionName,
  evolve: evolveV2,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    status: 'pending',
    productItemsCount: 0,
  }),
});
