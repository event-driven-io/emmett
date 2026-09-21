import type { D1Database } from '@cloudflare/workers-types';
import {
  assertDeepEqual,
  assertEqual,
  assertRejects,
  assertTrue,
  type Event,
} from '@event-driven-io/emmett';
import { pongoClient } from '@event-driven-io/pongo';
import { pongoDriver as d1PongoDriver } from '@event-driven-io/pongo/cloudflare';
import { Miniflare } from 'miniflare';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { d1EventStoreDriver } from '../../..';
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
  let mf: Miniflare;
  let database: D1Database;

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      d1Databases: { DB: 'test-db-id' },
    });
    database = await mf.getD1Database('DB');
  });

  afterAll(async () => {
    await mf.dispose();
  });

  void it(
    'throwing exception in a later projection and the events and the projected document are NOT rolled back',
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
        const notRolledBackStream = `shopping_cart:${uuid()}`;
        await assertRejects(
          store.appendToStream<ProductItemAdded>(notRolledBackStream, [
            { type: 'ProductItemAdded', data: { quantity: 3 } },
          ]),
        );

        assertDeepEqual(await summaryIn(collectionName, notRolledBackStream), {
          _id: notRolledBackStream,
          _version: 1n,
          productItemsCount: 3,
        });

        const { streamExists, events } =
          await store.readStream<ProductItemAdded>(notRolledBackStream);
        assertTrue(streamExists);
        assertEqual(1, events.length);
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

  void it('rejects a nested transaction and does NOT roll back when the caller disallows nesting', async () => {
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

      assertDeepEqual(await summaryIn(collectionName, streamName), {
        _id: streamName,
        _version: 1n,
        productItemsCount: 3,
      });
      assertTrue(await store.streamExists(streamName));
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
      driver: d1EventStoreDriver,
      database,
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
      driver: d1PongoDriver,
      database,
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
