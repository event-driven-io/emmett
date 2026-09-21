import type { DurableObjectStorage } from '@cloudflare/workers-types';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertIsNull,
  assertRejects,
  type Event,
} from '@event-driven-io/emmett';
import { pongoClient } from '@event-driven-io/pongo';
import { cloudflareDurableObjectSQLiteDriver } from '@event-driven-io/pongo/cloudflare';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { v4 as uuid } from 'uuid';
import { aroundEach, describe, it } from 'vitest';
import { durableObjectEventStoreDriver } from '../../..';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../../../../../eventStore/SQLiteEventStore';
import {
  pongoProjection,
  pongoSingleStreamProjection,
} from '../../../../../eventStore/projections/pongo/pongoProjections';
import { sqliteProjection } from '../../../../../eventStore/projections/sqliteProjection';

const withDeadline = { timeout: 30000 };

type ProductItemAdded = Event<'ProductItemAdded', { quantity: number }>;

type ShoppingCartSummary = { productItemsCount: number };

void describe('Pongo projection sharing the event store transaction', () => {
  let storage: DurableObjectStorage;

  aroundEach(async (runTest) => {
    const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());

    await runInDurableObject(stub, async (_instance, state) => {
      storage = state.storage;
      await runTest();
    });
  });

  void it(
    'rolls the events and the projected document back when a later projection throws',
    withDeadline,
    async () => {
      const collectionName = uniqueCollectionName();

      const migratingStore = storeWith(collectionName, []);
      try {
        await migratingStore.appendToStream<ProductItemAdded>(
          `shopping_cart:${uuid()}`,
          [{ type: 'ProductItemAdded', data: { quantity: 1 } }],
        );
      } finally {
        await migratingStore.close();
      }

      const store = storeWith(collectionName, [failingProjection()]);
      try {
        const rolledBackStream = `shopping_cart:${uuid()}`;
        await assertRejects(
          store.appendToStream<ProductItemAdded>(rolledBackStream, [
            { type: 'ProductItemAdded', data: { quantity: 3 } },
          ]),
        );

        assertIsNull(await summaryIn(collectionName, rolledBackStream));

        const { streamExists, events } =
          await store.readStream<ProductItemAdded>(rolledBackStream);
        assertFalse(streamExists);
        assertEqual(0, events.length);
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'lets a projection handler open its own Pongo transaction',
    withDeadline,
    async () => {
      const collectionName = uniqueCollectionName();
      const streamName = `shopping_cart:${uuid()}`;
      const store = storeWith(collectionName, [nestedTransactionProjection()]);

      try {
        await store.appendToStream<ProductItemAdded>(streamName, [
          { type: 'ProductItemAdded', data: { quantity: 3 } },
        ]);

        assertDeepEqual(await summaryIn(collectionName, streamName), {
          _id: streamName,
          _version: 1n,
          productItemsCount: 3,
        });
      } finally {
        await store.close();
      }
    },
  );

  void it('lets a projection handler nest a transaction on the event store connection', async () => {
    const collectionName = uniqueCollectionName();
    const streamName = `shopping_cart:${uuid()}`;
    const store = storeWith(collectionName, [
      nestedConnectionTransactionProjection(),
    ]);

    try {
      await store.appendToStream<ProductItemAdded>(streamName, [
        { type: 'ProductItemAdded', data: { quantity: 3 } },
      ]);

      assertDeepEqual(await summaryIn(collectionName, streamName), {
        _id: streamName,
        _version: 1n,
        productItemsCount: 3,
      });
    } finally {
      await store.close();
    }
  });

  void it('rejects a nested transaction and rolls back when the caller disallows nesting', async () => {
    const collectionName = uniqueCollectionName();
    const streamName = `shopping_cart:${uuid()}`;
    const store = storeWith(
      collectionName,
      [nestedConnectionTransactionProjection()],
      { allowNestedTransactions: false },
    );

    try {
      await assertRejects(
        store.appendToStream<ProductItemAdded>(streamName, [
          { type: 'ProductItemAdded', data: { quantity: 3 } },
        ]),
        isNestedTransactionsDisabledError,
      );

      assertIsNull(await summaryIn(collectionName, streamName));
      assertFalse(await store.streamExists(streamName));
    } finally {
      await store.close();
    }
  });

  const storeWith = (
    collectionName: string,
    alsoProjecting: InlineProjection[],
    transactionOptions?: { allowNestedTransactions: boolean },
  ): SQLiteEventStore =>
    getSQLiteEventStore({
      driver: durableObjectEventStoreDriver,
      storage,
      schema: { autoMigration: 'CreateOrUpdate' },
      ...(transactionOptions
        ? { connectionOptions: { transactionOptions } }
        : {}),
      projections: [
        {
          type: 'inline',
          projection: shoppingCartProjection(collectionName),
        },
        ...alsoProjecting.map((projection) => ({
          type: 'inline' as const,
          projection,
        })),
      ],
    });

  const summaryIn = async (collectionName: string, streamName: string) => {
    const pongo = pongoClient({
      driver: cloudflareDurableObjectSQLiteDriver,
      storage,
    });

    try {
      return await pongo
        .db()
        .collection<ShoppingCartSummary>(collectionName)
        .findOne({ _id: streamName });
    } finally {
      await pongo.close();
    }
  };
});

const uniqueCollectionName = () =>
  `shopping_cart_summary_${uuid().replaceAll('-', '_')}`;

const shoppingCartProjection = (collectionName: string) =>
  pongoSingleStreamProjection<ShoppingCartSummary, ProductItemAdded>({
    collectionName,
    canHandle: ['ProductItemAdded'],
    evolve: (document: ShoppingCartSummary, event: ProductItemAdded) => ({
      productItemsCount: document.productItemsCount + event.data.quantity,
    }),
    initialState: () => ({ productItemsCount: 0 }),
  });

const failingProjection = () =>
  pongoProjection<ProductItemAdded>({
    name: `failing_${uuid().replaceAll('-', '_')}`,
    canHandle: ['ProductItemAdded'],
    handle: () => Promise.reject(new Error('projection failed on purpose')),
  });

const nestedTransactionProjection = () =>
  pongoProjection<ProductItemAdded>({
    name: `nested_${uuid().replaceAll('-', '_')}`,
    canHandle: ['ProductItemAdded'],
    handle: (_events, { pongo }) =>
      pongo.db().withTransaction(() => Promise.resolve()),
  });

type InlineProjection =
  | ReturnType<typeof failingProjection>
  | ReturnType<typeof sqliteProjection<ProductItemAdded>>;

const isNestedTransactionsDisabledError = (error: unknown): boolean =>
  error instanceof Error &&
  'errorType' in error &&
  error.errorType === 'InvalidOperationError' &&
  error.message.includes('allowNestedTransactions');

const nestedConnectionTransactionProjection = (): InlineProjection =>
  sqliteProjection<ProductItemAdded>({
    name: `nested_connection_${uuid().replaceAll('-', '_')}`,
    canHandle: ['ProductItemAdded'],
    handle: (_events, { session }) =>
      session.connection.withTransaction(() => Promise.resolve()),
  });
