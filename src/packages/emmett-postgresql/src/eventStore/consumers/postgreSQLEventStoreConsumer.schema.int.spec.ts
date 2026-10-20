import {
  count,
  dumbo,
  PendingMigrationsError,
  SQL,
  SQLTableReference,
} from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertEqual,
  assertFalse,
  assertIsNotNull,
  assertRejects,
  type Event,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../testing/postgreSQLTestDatabase';
import { tableExists } from '../../testing/schemaObjects';
import type { ProductItemAdded } from '../../testing/shoppingCart.domain';
import { getPostgreSQLEventStore } from '../postgreSQLEventStore';
import {
  pongoSingleStreamProjection,
  postgreSQLProjection,
  readProjectionInfo,
} from '../projections';
import { readProcessorCheckpoint } from '../schema';
import {
  messagesTable,
  processorsTable,
  projectionsTable,
  tableReference,
} from '../schema/typing';
import { postgreSQLEventStoreConsumer } from './postgreSQLEventStoreConsumer';
import { pgEventStoreDriver } from '../../pg';

const withDeadline = { timeout: 30000 };

void describe('PostgreSQL event store consumer schema configuration', () => {
  let database: PostgreSQLTestDatabase;
  let connectionString: string;
  let pool: PgPool;
  const productItem = { price: 10, productId: uuid(), quantity: 10 };

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
    connectionString = database.connectionString;
    pool = dumbo({
      connectionString,
      driver: pgDumboDriver,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    });
  });

  afterAll(async () => {
    try {
      await pool?.close();
      await database?.close();
    } catch (error) {
      console.log(error);
    }
  });

  void it(
    'passes the configured schema names to inline PostgreSQL projection handlers',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      let migrationTableSchemaName: string | undefined;
      let projectionsDatabaseSchemaName: string | undefined;
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString: connectionString,
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName: eventSchemaName,
          migrationTable: {
            tableName: 'custom_migrations',
          },
        },
        projections: [
          {
            type: 'inline',
            projection: postgreSQLProjection<ProductItemAdded>({
              name: schemaName('projection'),
              canHandle: ['ProductItemAdded'],
              handle: (_events, context) => {
                migrationTableSchemaName =
                  context.migrationOptions?.migrationTable?.schemaName;
                projectionsDatabaseSchemaName =
                  context.migrationOptions?.projectionsDatabaseSchemaName;
              },
            }),
          },
        ],
      });

      try {
        await store.appendToStream(`shopping_cart-${uuid()}`, [
          { type: 'ProductItemAdded', data: { productItem } },
        ]);

        assertEqual(migrationTableSchemaName, eventSchemaName);
        assertEqual(projectionsDatabaseSchemaName, eventSchemaName);
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'keeps processor checkpoints and projection registrations in the configured event-store schema',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const projectionSchemaName = schemaName('read_models');
      const processorId = `processor:${uuid()}`;
      const projectionName = schemaName('projection');
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString: connectionString,
        schema: {
          autoMigration: 'None',
          databaseSchemaName: eventSchemaName,
          projectionsDatabaseSchemaName: projectionSchemaName,
          migrationTable: {
            schemaName: schemaName('infrastructure'),
            tableName: 'emmett_migrations',
          },
        },
      });

      try {
        await store.schema.migrate();

        const consumer = store.consumer<ProductItemAdded>({
          stopWhen: { noMessagesLeft: true },
        });
        consumer.projector({
          processorId,
          projection: postgreSQLProjection<ProductItemAdded>({
            name: projectionName,
            canHandle: ['ProductItemAdded'],
            handle: () => {},
          }),
        });

        await store.appendToStream(`shopping_cart-${uuid()}`, [
          { type: 'ProductItemAdded', data: { productItem } },
        ]);
        await consumer.start();

        const checkpoint = await readProcessorCheckpoint(pool.execute, {
          processorId,
          databaseSchemaName: eventSchemaName,
        });
        const registration = await readProjectionInfo(pool.execute, {
          databaseSchemaName: eventSchemaName,
          name: projectionName,
          partition: 'emt:default',
          version: 1,
        });

        assertIsNotNull(checkpoint);
        assertIsNotNull(registration);
        assertFalse(
          await tableExists(
            pool.execute,
            processorsTable.name,
            projectionSchemaName,
          ),
        );
        assertFalse(await tableExists(pool.execute, processorsTable.name));
        assertFalse(
          await tableExists(
            pool.execute,
            projectionsTable.name,
            projectionSchemaName,
          ),
        );
        assertFalse(await tableExists(pool.execute, projectionsTable.name));
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'passes the configured schema names to PostgreSQL projection initialization',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const processorId = `processor:${uuid()}`;
      const projectionName = schemaName('projection');
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString: connectionString,
        schema: {
          autoMigration: 'None',
          databaseSchemaName: eventSchemaName,
          migrationTable: {
            tableName: 'custom_migrations',
          },
        },
      });

      try {
        await store.schema.migrate();

        let migrationTableSchemaName: string | undefined;
        let projectionsDatabaseSchemaName: string | undefined;

        const consumer = store.consumer<ProductItemAdded>({
          stopWhen: { noMessagesLeft: true },
        });
        consumer.projector({
          processorId,
          projection: postgreSQLProjection<ProductItemAdded>({
            name: projectionName,
            canHandle: ['ProductItemAdded'],
            handle: () => {},
            init: ({ context }) => {
              migrationTableSchemaName =
                context.migrationOptions?.migrationTable?.schemaName;
              projectionsDatabaseSchemaName =
                context.migrationOptions?.projectionsDatabaseSchemaName;
            },
          }),
        });

        await consumer.start();

        assertEqual(migrationTableSchemaName, eventSchemaName);
        assertEqual(projectionsDatabaseSchemaName, eventSchemaName);
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'keeps events appended by consumer handlers in the configured event-store schema',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const guestId = uuid();
      const sourceStreamName = `guestStay-${guestId}`;
      const reactionStreamName = `reaction-${guestId}`;
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString: connectionString,
        schema: {
          autoMigration: 'None',
          databaseSchemaName: eventSchemaName,
        },
      });

      try {
        await store.schema.migrate();
        const consumer = store.consumer<GuestStayEvent>();
        consumer.reactor({
          processorId: `processor:${uuid()}`,
          startFrom: 'CURRENT',
          canHandle: ['GuestCheckedIn'],
          eachMessage: async (event, context) => {
            await context.session.messageStore.appendToStream(
              reactionStreamName,
              [
                {
                  type: 'GuestCheckedOut',
                  data: { guestId: event.data.guestId },
                },
              ],
            );
          },
        });

        try {
          void consumer.start();
          await consumer.whenStarted();
          await store.appendToStream(sourceStreamName, [
            { type: 'GuestCheckedIn', data: { guestId } },
          ]);
          await consumer.whenCaughtUp();
        } finally {
          await consumer.close();
        }

        assertEqual(
          1,
          await messagesInStream(eventSchemaName, reactionStreamName),
        );
        assertFalse(await tableExists(pool.execute, messagesTable.name));
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'keeps events appended by direct consumer handlers in the configured event-store schema',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const guestId = uuid();
      const sourceStreamName = `guestStay-${guestId}`;
      const reactionStreamName = `reaction-${guestId}`;
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString: connectionString,
        schema: {
          autoMigration: 'None',
          databaseSchemaName: eventSchemaName,
        },
      });

      try {
        await store.schema.migrate();
        const consumer = postgreSQLEventStoreConsumer<GuestStayEvent>({
          connectionString,
          schema: {
            databaseSchemaName: eventSchemaName,
          },
        });
        consumer.reactor({
          processorId: `processor:${uuid()}`,
          startFrom: 'CURRENT',
          canHandle: ['GuestCheckedIn'],
          eachMessage: async (event, context) => {
            await context.session.messageStore.appendToStream(
              reactionStreamName,
              [
                {
                  type: 'GuestCheckedOut',
                  data: { guestId: event.data.guestId },
                },
              ],
            );
          },
        });

        try {
          void consumer.start();
          await consumer.whenStarted();
          await store.appendToStream(sourceStreamName, [
            { type: 'GuestCheckedIn', data: { guestId } },
          ]);
          await consumer.whenCaughtUp();
        } finally {
          await consumer.close();
        }

        assertEqual(
          1,
          await messagesInStream(eventSchemaName, reactionStreamName),
        );
        assertFalse(await tableExists(pool.execute, messagesTable.name));
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'keeps events appended through a session in the configured event-store schema',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const guestId = uuid();
      const streamName = `guestStay-${guestId}`;
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString: connectionString,
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName: eventSchemaName,
        },
      });

      try {
        await store.withSession(({ eventStore }) =>
          eventStore.appendToStream(streamName, [
            { type: 'GuestCheckedIn', data: { guestId } },
          ]),
        );

        assertEqual(1, await messagesInStream(eventSchemaName, streamName));
        assertFalse(await tableExists(pool.execute, messagesTable.name));
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'keeps events appended through a supplied Dumbo pool in the configured event-store schema',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const guestId = uuid();
      const streamName = `guestStay-${guestId}`;
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString: connectionString,
        pool: pool,
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName: eventSchemaName,
        },
      });

      await store.appendToStream(streamName, [
        { type: 'GuestCheckedIn', data: { guestId } },
      ]);

      assertEqual(1, await messagesInStream(eventSchemaName, streamName));
      assertFalse(await tableExists(pool.execute, messagesTable.name));
    },
  );

  void it(
    'reads events from the event-store schema and stores async Pongo projections in the projection schema',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const projectionSchemaName = schemaName('read_models');
      const collectionName = schemaName('shopping_cart_summary');
      const streamName = `shopping_cart-${uuid()}`;
      const projection = shoppingCartSummaryProjection(collectionName);
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString: connectionString,
        schema: {
          autoMigration: 'None',
          databaseSchemaName: eventSchemaName,
          projectionsDatabaseSchemaName: projectionSchemaName,
        },
        projections: [{ type: 'async', projection }],
      });

      try {
        await store.schema.migrate();

        const consumer = store.consumer<ProductItemAdded>();
        consumer.projector({
          processorId: `processor:${uuid()}`,
          projection,
        });

        void consumer.start();
        try {
          await consumer.whenStarted();

          await store.appendToStream(streamName, [
            { type: 'ProductItemAdded', data: { productItem } },
          ]);

          await consumer.whenCaughtUp();
        } finally {
          await consumer.close();
        }

        assertEqual(1, await rowsInTable(projectionSchemaName, collectionName));
        assertEqual(1, await messagesInStream(eventSchemaName, streamName));
        assertFalse(
          await tableExists(pool.execute, collectionName, eventSchemaName),
        );
        assertFalse(await tableExists(pool.execute, collectionName));
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'creates no projection tables in projector initialization when the consumer skips migrations',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const collectionName = schemaName('shopping_cart_summary');
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString: connectionString,
        schema: { autoMigration: 'None', databaseSchemaName: eventSchemaName },
      });

      try {
        await store.schema.migrate();

        const consumer = store.consumer<ProductItemAdded>({
          stopWhen: { noMessagesLeft: true },
          schema: { autoMigration: 'None' },
        });
        consumer.projector({
          processorId: `processor:${uuid()}`,
          projection: shoppingCartSummaryProjection(collectionName),
        });

        await consumer.start();

        assertFalse(
          await tableExists(pool.execute, collectionName, eventSchemaName),
        );
        assertIsNotNull(
          await readProjectionInfo(pool.execute, {
            databaseSchemaName: eventSchemaName,
            name: collectionName,
            partition: 'emt:default',
            version: 1,
          }),
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'creates no projection tables in projector initialization when the event store skips migrations',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const collectionName = schemaName('shopping_cart_summary');
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString: connectionString,
        schema: { autoMigration: 'None', databaseSchemaName: eventSchemaName },
      });

      try {
        await store.schema.migrate();

        const consumer = store.consumer<ProductItemAdded>({
          stopWhen: { noMessagesLeft: true },
        });
        consumer.projector({
          processorId: `processor:${uuid()}`,
          projection: shoppingCartSummaryProjection(collectionName),
        });

        await consumer.start();

        assertFalse(
          await tableExists(pool.execute, collectionName, eventSchemaName),
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'fails to start the consumer when projection migrations are pending and the consumer ensures migrations',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const collectionName = schemaName('shopping_cart_summary');
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString: connectionString,
        schema: { autoMigration: 'None', databaseSchemaName: eventSchemaName },
      });

      try {
        await store.schema.migrate();

        const consumer = store.consumer<ProductItemAdded>({
          stopWhen: { noMessagesLeft: true },
          schema: { autoMigration: 'EnsureMigrated' },
        });
        consumer.projector({
          processorId: `processor:${uuid()}`,
          projection: shoppingCartSummaryProjection(collectionName),
        });

        await assertRejects(
          consumer.start(),
          (error) =>
            error instanceof PendingMigrationsError &&
            error.pendingMigrations.some(({ name }) =>
              name.includes(collectionName),
            ),
        );
        assertFalse(
          await tableExists(pool.execute, collectionName, eventSchemaName),
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'projects events when the user migrated the projection and the consumer ensures migrations',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const collectionName = schemaName('shopping_cart_summary');
      const projection = shoppingCartSummaryProjection(collectionName);
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString: connectionString,
        schema: { autoMigration: 'None', databaseSchemaName: eventSchemaName },
        projections: [{ type: 'async', projection }],
      });

      try {
        await store.schema.migrate();

        const consumer = store.consumer<ProductItemAdded>({
          schema: { autoMigration: 'EnsureMigrated' },
        });
        consumer.projector({
          processorId: `processor:${uuid()}`,
          projection,
        });

        void consumer.start();
        try {
          await consumer.whenStarted();

          await store.appendToStream(`shopping_cart-${uuid()}`, [
            { type: 'ProductItemAdded', data: { productItem } },
          ]);

          await consumer.whenCaughtUp();
        } finally {
          await consumer.close();
        }

        assertEqual(1, await rowsInTable(eventSchemaName, collectionName));
      } finally {
        await store.close();
      }
    },
  );

  const messagesInStream = (
    databaseSchemaName: string,
    streamName: string,
  ): Promise<number> =>
    count(
      pool.execute.query<{ count: number }>(
        SQL`
          SELECT COUNT(*)::integer AS count
          FROM ${tableReference(databaseSchemaName, messagesTable.name)}
          WHERE stream_id = ${streamName}
        `,
      ),
    );

  const rowsInTable = (
    databaseSchemaName: string,
    tableName: string,
  ): Promise<number> =>
    count(
      pool.execute.query<{ count: number }>(
        SQL`
          SELECT COUNT(*)::integer AS count
          FROM ${SQLTableReference.from({ databaseSchemaName, tableName })}
        `,
      ),
    );
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;

type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;

type ShoppingCartSummary = {
  productItemsCount: number;
};

const shoppingCartSummaryProjection = (collectionName: string) =>
  pongoSingleStreamProjection<ShoppingCartSummary, ProductItemAdded>({
    collectionName,
    canHandle: ['ProductItemAdded'],
    evolve: (
      document: ShoppingCartSummary,
      event: ProductItemAdded,
    ): ShoppingCartSummary => ({
      productItemsCount:
        document.productItemsCount + event.data.productItem.quantity,
    }),
    initialState: () => ({ productItemsCount: 0 }),
  });

const schemaName = (prefix: string): string =>
  `${prefix}_${uuid().replaceAll('-', '_')}`;
