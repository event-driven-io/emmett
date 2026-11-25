import { sqlite3Pool } from '@event-driven-io/dumbo/sqlite3';
import {
  assertEqual,
  assertThrowsAsync,
  type Event,
} from '@event-driven-io/emmett';
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';

type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: { productId: string; quantity: number } }
>;

const productItemAdded = (quantity: number): ProductItemAdded => ({
  type: 'ProductItemAdded',
  data: { productItem: { productId: 'shoes', quantity } },
});

void describe('SQLite event store sessions', () => {
  let fileName: string;

  beforeEach(() => {
    fileName = path.join(os.tmpdir(), `emmett-snippets-${uuid()}.db`);
  });

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm'])
      fs.rmSync(`${fileName}${suffix}`, { force: true });
  });

  void it('rejects an append in the before-commit hook', async () => {
    // #region sqlite-before-commit-hook
    const isProductItemAdded = (message: Event): message is ProductItemAdded =>
      message.type === 'ProductItemAdded';

    const eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName,
      hooks: {
        onBeforeCommit: (messages) => {
          for (const message of messages) {
            if (
              isProductItemAdded(message) &&
              message.data.productItem.quantity > 100
            ) {
              throw new Error('Quantity too large');
            }
          }
        },
      },
    });
    // #endregion sqlite-before-commit-hook

    try {
      await assertThrowsAsync(
        () =>
          eventStore.appendToStream(`shopping_cart-${uuid()}`, [
            productItemAdded(101),
          ]),
        (error) => error.message === 'Quantity too large',
      );
    } finally {
      await eventStore.close();
    }
  });

  void it('commits appends to many streams together in a session that opens a transaction', async () => {
    const eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName,
    });
    const cartId = `shopping_cart-${uuid()}`;
    const otherCartId = `shopping_cart-${uuid()}`;

    try {
      // #region sqlite-transactional-session
      await eventStore.withSession(
        async ({ eventStore: session }) => {
          await session.appendToStream(cartId, [productItemAdded(1)]);
          await session.appendToStream(otherCartId, [productItemAdded(2)]);
        },
        { transaction: true },
      );
      // #endregion sqlite-transactional-session

      assertEqual(1, (await eventStore.readStream(cartId)).events.length);
      assertEqual(1, (await eventStore.readStream(otherCartId)).events.length);
    } finally {
      await eventStore.close();
    }
  });

  void it('commits appends with a transaction opened by the caller', async () => {
    const eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName,
    });
    const cartId = `shopping_cart-${uuid()}`;

    try {
      await eventStore.schema.migrate();

      // #region sqlite-join-transaction
      const pool = sqlite3Pool({
        fileName,
        transactionOptions: { allowNestedTransactions: true },
      });

      await pool.withTransaction((transaction) =>
        eventStore.withSession(
          ({ eventStore: session }) =>
            session.appendToStream(cartId, [productItemAdded(1)]),
          { transaction },
        ),
      );
      // #endregion sqlite-join-transaction

      await pool.close();

      assertEqual(1, (await eventStore.readStream(cartId)).events.length);
    } finally {
      await eventStore.close();
    }
  });
});
