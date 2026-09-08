import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertIsNull,
  assertRejects,
  type Event,
} from '@event-driven-io/emmett';
import { pongoClient } from '@event-driven-io/pongo';
import { pgDriver } from '@event-driven-io/pongo/pg';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { pgEventStoreDriver } from '../../../pg';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../../testing/postgreSQLTestDatabase';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../../postgreSQLEventStore';
import {
  pongoProjection,
  pongoSingleStreamProjection,
} from './pongoProjections';

const withDeadline = { timeout: 30000 };

type ProductItemAdded = Event<'ProductItemAdded', { quantity: number }>;

type ShoppingCartSummary = { productItemsCount: number };

void describe('Pongo projection sharing the event store transaction', () => {
  let database: PostgreSQLTestDatabase;
  let connectionString: string;

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
    connectionString = database.connectionString;
  });

  afterAll(async () => {
    await database?.close();
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

  const storeWith = (
    collectionName: string,
    alsoProjecting: ReturnType<typeof failingProjection>[],
  ): PostgresEventStore =>
    getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString,
      schema: { autoMigration: 'CreateOrUpdate' },
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
    const pongo = pongoClient({ connectionString, driver: pgDriver });

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
