import { assertMatches, type Event } from '@event-driven-io/emmett';
import {
  getPostgreSQLEventStore,
  pongoSingleStreamProjection,
} from '@event-driven-io/emmett-postgresql';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { pongoClient, type PongoClient } from '@event-driven-io/pongo';
import { pgDriver } from '@event-driven-io/pongo/pg';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';

type ProductItemAdded = Event<'ProductItemAdded', { quantity: number }>;
type ShoppingCartConfirmed = Event<'ShoppingCartConfirmed', { at: Date }>;
type ShoppingCartEvent = ProductItemAdded | ShoppingCartConfirmed;

type ShoppingCartSummary = {
  status: string;
  productItemsCount: number;
};

const shoppingCartsSummaryCollectionName = 'shoppingCartsSummary';

const shoppingCartsSummaryProjection = pongoSingleStreamProjection({
  collectionName: shoppingCartsSummaryCollectionName,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({ status: 'pending', productItemsCount: 0 }),
  evolve: (
    document: ShoppingCartSummary,
    event: ShoppingCartEvent,
  ): ShoppingCartSummary => {
    switch (event.type) {
      case 'ProductItemAdded':
        return {
          ...document,
          productItemsCount:
            document.productItemsCount + event.data.quantity,
        };
      case 'ShoppingCartConfirmed':
        return { ...document, status: 'confirmed' };
    }
  },
});

void describe('PostgreSQL consumer', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let pongo: PongoClient;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:15-alpine').start();
    connectionString = postgres.getConnectionUri();
    pongo = pongoClient({
      connectionString,
      driver: pgDriver,
      connectionOptions: {
        transactionOptions: { allowNestedTransactions: true },
      },
    });
  });

  afterAll(async () => {
    await pongo.close();
    await postgres.stop();
  });

  void it('projects appended events', async () => {
    const eventStore = getPostgreSQLEventStore(connectionString);
    const streamName = `shopping_cart-${uuid()}`;

    await eventStore.appendToStream<ShoppingCartEvent>(streamName, [
      { type: 'ProductItemAdded', data: { quantity: 2 } },
      { type: 'ShoppingCartConfirmed', data: { at: new Date() } },
    ]);

    // #region postgresql-consumer
    const consumer = eventStore.consumer<ShoppingCartEvent>();

    consumer.projector({
      processorId: 'shopping-carts-summary',
      projection: shoppingCartsSummaryProjection,
    });

    const running = consumer.start();
    await consumer.whenCaughtUp();
    // #endregion postgresql-consumer

    const summary = await pongo
      .db()
      .collection<ShoppingCartSummary>(shoppingCartsSummaryCollectionName)
      .findOne({ _id: streamName });

    assertMatches(summary, { status: 'confirmed', productItemsCount: 2 });

    // #region postgresql-consumer-close
    await consumer.close();

    // the store stays open, keep using it
    await eventStore.appendToStream<ShoppingCartEvent>(streamName, [
      { type: 'ProductItemAdded', data: { quantity: 1 } },
    ]);

    await eventStore.close();
    // #endregion postgresql-consumer-close

    await running;
  });
});
