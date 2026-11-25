import { dumbo } from '@event-driven-io/dumbo';
import { pgDumboDriver } from '@event-driven-io/dumbo/pg';
import { assertEqual, type Event } from '@event-driven-io/emmett';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { pgEventStoreDriver } from '@event-driven-io/emmett-postgresql/pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';

type ProductItemAdded = Event<'ProductItemAdded', { quantity: number }>;

const productItemAdded = (quantity: number): ProductItemAdded => ({
  type: 'ProductItemAdded',
  data: { quantity },
});

void describe('PostgreSQL event store sessions', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:15-alpine').start();
    connectionString = postgres.getConnectionUri();
  });

  afterAll(async () => {
    await postgres.stop();
  });

  void it('commits appends to many streams together in a session that opens a transaction', async () => {
    const eventStore = getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString,
    });
    const cartId = `shopping_cart-${uuid()}`;
    const otherCartId = `shopping_cart-${uuid()}`;

    try {
      // #region postgresql-transactional-session
      await eventStore.withSession(
        async ({ eventStore: session }) => {
          await session.appendToStream(cartId, [productItemAdded(1)]);
          await session.appendToStream(otherCartId, [productItemAdded(2)]);
        },
        { transaction: true },
      );
      // #endregion postgresql-transactional-session

      assertEqual(1, (await eventStore.readStream(cartId)).events.length);
      assertEqual(1, (await eventStore.readStream(otherCartId)).events.length);
    } finally {
      await eventStore.close();
    }
  });

  void it('commits appends with a transaction opened by the caller', async () => {
    const eventStore = getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString,
    });
    const cartId = `shopping_cart-${uuid()}`;

    try {
      await eventStore.schema.migrate();

      // #region postgresql-join-transaction
      const pool = dumbo({
        driver: pgDumboDriver,
        connectionString,
        transactionOptions: { allowNestedTransactions: true },
      });

      await pool.withTransaction((transaction) =>
        eventStore.withSession(
          ({ eventStore: session }) =>
            session.appendToStream(cartId, [productItemAdded(1)]),
          { transaction },
        ),
      );
      // #endregion postgresql-join-transaction

      await pool.close();

      assertEqual(1, (await eventStore.readStream(cartId)).events.length);
    } finally {
      await eventStore.close();
    }
  });
});
