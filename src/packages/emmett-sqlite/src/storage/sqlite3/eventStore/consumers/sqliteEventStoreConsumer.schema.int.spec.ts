import {
  count,
  dumboSchema,
  PendingMigrationsError,
  SQL,
  sqlMigration,
  SQLTableReference,
} from '@event-driven-io/dumbo';
import { sqliteTableName } from '@event-driven-io/dumbo/sqlite';
import {
  sqlite3Pool,
  tableExists,
  type SQLite3Connection,
  type SQLitePool,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertIsNotNull,
  assertRejects,
  assertTrue,
  inMemoryReactor,
  workflowStreamName,
  type Event,
  type WorkflowOptions,
} from '@event-driven-io/emmett';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { sqlite3EventStoreDriver } from '../../../../sqlite3';
import {
  GroupCheckoutWorkflow,
  type GroupCheckout,
  type GroupCheckoutInput,
  type GroupCheckoutOutput,
} from '../../../../testing/groupCheckout.domain';
import { deleteSQLiteDatabaseFiles } from '../../testing/sqliteTestDatabase';
import { getSQLiteEventStore } from '../../../../eventStore/SQLiteEventStore';
import { readProcessorCheckpoint } from '../../../../eventStore/schema';
import {
  messagesTable,
  processorsTable,
} from '../../../../eventStore/schema/typing';
import { pongoClient } from '@event-driven-io/pongo';
import {
  pongoSingleStreamProjection,
  sqliteRawSQLProjection,
} from '../../../../eventStore/projections';
import { sqliteEventStoreConsumer } from '../../../../eventStore/consumers/sqliteEventStoreConsumer';
import { pongoDriverOf } from '../../../../eventStore/eventStoreDriver';

const withDeadline = { timeout: 30000 };

const { column, table } = dumboSchema;
const { Text } = SQL.column.type;

const workflowProcessorOptions: WorkflowOptions<
  GroupCheckoutInput,
  GroupCheckout,
  GroupCheckoutOutput
> = {
  workflow: GroupCheckoutWorkflow,
  getWorkflowId: (input) =>
    (input.data as { groupCheckoutId?: string }).groupCheckoutId ?? null,
  inputs: {
    commands: ['InitiateGroupCheckout', 'TimeoutGroupCheckout'],
    events: ['GuestCheckedOut', 'GuestCheckoutFailed'],
  },
  outputs: {
    commands: ['CheckOut'],
    events: [
      'GroupCheckoutCompleted',
      'GroupCheckoutFailed',
      'GroupCheckoutTimedOut',
    ],
  },
};

void describe('SQLite event store consumer schema configuration', () => {
  const testDatabasePath = path.dirname(fileURLToPath(import.meta.url));
  const fileName = path.resolve(testDatabasePath, 'consumer-schema.db');
  const databaseSchemaName = 'events';

  let pool: SQLitePool<SQLite3Connection>;

  beforeEach(() => {
    pool = sqlite3Pool({
      fileName,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    });
  });

  afterEach(async () => {
    await pool.close();
    deleteSQLiteDatabaseFiles(fileName);
  });

  void it(
    'keeps processor checkpoints in the configured event-store schema',
    withDeadline,
    async () => {
      const processorId = `processor:${uuid()}`;
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'CreateOrUpdate', databaseSchemaName },
      });
      const consumer = eventStore.consumer<GuestStayEvent>({
        stopWhen: { noMessagesLeft: true },
      });
      consumer.reactor({
        processorId,
        canHandle: ['GuestCheckedIn'],
        eachMessage: () => {},
      });

      await eventStore.appendToStream(`guestStay-${uuid()}`, [
        { type: 'GuestCheckedIn', data: { guestId: uuid() } },
      ]);
      try {
        await consumer.start();
      } finally {
        await consumer.close();
        await eventStore.close();
      }

      const { lastProcessedCheckpoint } = await readProcessorCheckpoint(
        pool.execute,
        { processorId, databaseSchemaName },
      );

      assertIsNotNull(lastProcessedCheckpoint);
      assertFalse(await tableExists(pool.execute, processorsTable.name));
    },
  );

  void it(
    'keeps messages stored by workflow processors in the configured event-store schema',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'None', databaseSchemaName },
      });
      await eventStore.schema.migrate();
      await eventStore.appendToStream(`groupCheckout-${groupCheckoutId}`, [
        initiateGroupCheckout(groupCheckoutId),
      ]);

      const consumer = eventStore.consumer();
      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutInitiated' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
        await eventStore.close();
      }

      assertDeepEqual(
        await messageTypesInStream(workflowStream(groupCheckoutId)),
        [
          'GroupCheckoutWorkflow:InitiateGroupCheckout',
          'GroupCheckoutInitiated',
          'CheckOut',
          'CheckOut',
        ],
      );
      assertFalse(await tableExists(pool.execute, messagesTable.name));
    },
  );

  void it(
    'keeps messages stored by directly created consumers in the configured event-store schema',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'None', databaseSchemaName },
      });
      await eventStore.schema.migrate();
      await eventStore.appendToStream(`groupCheckout-${groupCheckoutId}`, [
        initiateGroupCheckout(groupCheckoutId),
      ]);

      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { databaseSchemaName },
      });
      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutInitiated' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
        await eventStore.close();
      }

      assertDeepEqual(
        await messageTypesInStream(workflowStream(groupCheckoutId)),
        [
          'GroupCheckoutWorkflow:InitiateGroupCheckout',
          'GroupCheckoutInitiated',
          'CheckOut',
          'CheckOut',
        ],
      );
      assertFalse(await tableExists(pool.execute, messagesTable.name));
    },
  );

  void it(
    'keeps events appended through a session in the configured event-store schema',
    withDeadline,
    async () => {
      const guestId = uuid();
      const streamName = `guestStay-${guestId}`;
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'CreateOrUpdate', databaseSchemaName },
      });

      try {
        await eventStore.withSession(({ eventStore }) =>
          eventStore.appendToStream(streamName, [
            { type: 'GuestCheckedIn', data: { guestId } },
          ]),
        );
      } finally {
        await eventStore.close();
      }

      assertEqual(1, await messagesInStream(streamName));
      assertFalse(await tableExists(pool.execute, messagesTable.name));
    },
  );

  void it(
    'keeps events appended through a supplied Dumbo pool in the configured event-store schema',
    withDeadline,
    async () => {
      const guestId = uuid();
      const streamName = `guestStay-${guestId}`;
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        pool,
        schema: { autoMigration: 'CreateOrUpdate', databaseSchemaName },
      });

      await eventStore.appendToStream(streamName, [
        { type: 'GuestCheckedIn', data: { guestId } },
      ]);

      assertEqual(1, await messagesInStream(streamName));
      assertFalse(await tableExists(pool.execute, messagesTable.name));
    },
  );

  void it(
    'reads events from the event-store schema and stores async Pongo projections in the projection schema',
    withDeadline,
    async () => {
      const projectionsDatabaseSchemaName = 'read_models';
      const collectionName = 'shopping_cart_summary';
      const streamName = `shopping_cart-${uuid()}`;
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: {
          autoMigration: 'None',
          databaseSchemaName,
          projectionsDatabaseSchemaName,
        },
        projections: [
          {
            type: 'async',
            projection: guestStaySummaryProjection(collectionName),
          },
        ],
      });

      try {
        await eventStore.schema.migrate();
        await eventStore.appendToStream(streamName, [
          { type: 'GuestCheckedIn', data: { guestId: uuid() } },
        ]);

        const consumer = eventStore.consumer<GuestStayEvent>({
          stopWhen: { noMessagesLeft: true },
        });

        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }
      } finally {
        await eventStore.close();
      }

      assertDeepEqual(
        await summaryIn(
          projectionsDatabaseSchemaName,
          collectionName,
          streamName,
        ),
        { _id: streamName, _version: 1n, checkedInCount: 1 },
      );
      assertFalse(await tableExists(pool.execute, collectionName));
      assertFalse(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName: collectionName }),
        ),
      );
    },
  );

  void it(
    'records projector migrations in the event-store schema when the projector sets its own schema names and autoMigration',
    withDeadline,
    async () => {
      const projectionsDatabaseSchemaName = 'read_models';
      const collectionName = 'shopping_cart_summary';
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'None', databaseSchemaName },
      });

      try {
        await eventStore.schema.migrate();

        const consumer = eventStore.consumer<GuestStayEvent>({
          stopWhen: { noMessagesLeft: true },
        });
        consumer.projector({
          processorId: `processor:${uuid()}`,
          projection: guestStaySummaryProjection(collectionName),
          migrationOptions: {
            databaseSchemaName,
            projectionsDatabaseSchemaName,
            autoMigration: 'CreateOrUpdate',
          },
        });

        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }
      } finally {
        await eventStore.close();
      }

      assertTrue(
        await tableExists(
          pool.execute,
          sqliteTableName({
            databaseSchemaName: projectionsDatabaseSchemaName,
            tableName: collectionName,
          }),
        ),
      );
      assertTrue(
        (await migrationNames(databaseSchemaName)).some((name) =>
          name.includes(collectionName),
        ),
      );
    },
  );

  void it(
    'creates no projection tables when the projector sets its own schema names without autoMigration and the event store skips migrations',
    withDeadline,
    async () => {
      const projectionsDatabaseSchemaName = 'read_models';
      const collectionName = 'shopping_cart_summary';
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'None', databaseSchemaName },
      });

      try {
        await eventStore.schema.migrate();

        const consumer = eventStore.consumer<GuestStayEvent>({
          stopWhen: { noMessagesLeft: true },
        });
        consumer.projector({
          processorId: `processor:${uuid()}`,
          projection: guestStaySummaryProjection(collectionName),
          migrationOptions: {
            databaseSchemaName,
            projectionsDatabaseSchemaName,
          },
        });

        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }
      } finally {
        await eventStore.close();
      }

      assertFalse(
        await tableExists(
          pool.execute,
          sqliteTableName({
            databaseSchemaName: projectionsDatabaseSchemaName,
            tableName: collectionName,
          }),
        ),
      );
    },
  );

  void it(
    "creates the projection in the projector's own projections schema when the projector sets its own schema names without autoMigration",
    withDeadline,
    async () => {
      const projectionsDatabaseSchemaName = 'read_models';
      const collectionName = 'shopping_cart_summary';
      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
        stopWhen: { noMessagesLeft: true },
        schema: { databaseSchemaName },
      });
      consumer.projector({
        processorId: `processor:${uuid()}`,
        projection: guestStaySummaryProjection(collectionName),
        migrationOptions: {
          databaseSchemaName,
          projectionsDatabaseSchemaName,
        },
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      assertTrue(
        await tableExists(
          pool.execute,
          sqliteTableName({
            databaseSchemaName: projectionsDatabaseSchemaName,
            tableName: collectionName,
          }),
        ),
      );
      assertTrue(
        (await migrationNames(databaseSchemaName)).some((name) =>
          name.includes(collectionName),
        ),
      );
    },
  );

  const summaryIn = (
    databaseSchemaName: string,
    collectionName: string,
    streamName: string,
  ) =>
    pool.withConnection(async (connection) => {
      const driver = pongoDriverOf(sqlite3EventStoreDriver);
      const pongo = pongoClient({
        driver,
        connectionOptions: { connection },
        defaultSchemaName: databaseSchemaName,
      });
      try {
        return await pongo
          .db()
          .collection<GuestStaySummary>(collectionName)
          .findOne({ _id: streamName });
      } finally {
        await pongo.close();
      }
    });

  const initiateGroupCheckout = (groupCheckoutId: string) => ({
    type: 'InitiateGroupCheckout' as const,
    data: {
      groupCheckoutId,
      clerkId: 'clerk-1',
      guestStayAccountIds: [uuid(), uuid()],
      now: new Date(),
    },
  });

  const workflowStream = (groupCheckoutId: string): string =>
    workflowStreamName({
      workflowName: 'GroupCheckoutWorkflow',
      workflowId: groupCheckoutId,
    });

  const messageTypesInStream = async (
    streamName: string,
  ): Promise<string[]> => {
    const result = await pool.execute.query<{ message_type: string }>(
      SQL`
        SELECT message_type
        FROM ${SQLTableReference.from({
          databaseSchemaName,
          tableName: messagesTable.name,
        })}
        WHERE stream_id = ${streamName}
        ORDER BY global_position
      `,
    );

    return result.rows.map((row) => row.message_type);
  };

  void it(
    "does not migrate the store's projections again when its consumer starts after the store migrated",
    withDeadline,
    async () => {
      const collectionName = 'guest_stay_summary';
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'CreateOrUpdate', databaseSchemaName },
        projections: [
          {
            type: 'async',
            projection: guestStaySummaryProjection(collectionName),
          },
        ],
      });

      try {
        await eventStore.schema.migrate();
        await dropTableWithMigrations(databaseSchemaName, collectionName);

        const consumer = eventStore.consumer<GuestStayEvent>({
          stopWhen: { noMessagesLeft: true },
        });
        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }

        assertFalse(
          await tableExists(
            pool.execute,
            sqliteTableName({ databaseSchemaName, tableName: collectionName }),
          ),
        );
      } finally {
        await eventStore.close();
      }
    },
  );

  void it(
    "migrates the store's projections when its consumer starts before the store migrated",
    withDeadline,
    async () => {
      const collectionName = 'guest_stay_summary';
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'CreateOrUpdate', databaseSchemaName },
        projections: [
          {
            type: 'async',
            projection: guestStaySummaryProjection(collectionName),
          },
        ],
      });

      try {
        const consumer = eventStore.consumer<GuestStayEvent>({
          stopWhen: { noMessagesLeft: true },
        });
        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }

        assertTrue(
          await tableExists(
            pool.execute,
            sqliteTableName({ databaseSchemaName, tableName: collectionName }),
          ),
        );
        assertDeepEqual((await eventStore.schema.migrate()).applied, []);
      } finally {
        await eventStore.close();
      }
    },
  );

  void it(
    "migrates the store's projections when the consumer sets its own autoMigration and the store skips migrations",
    withDeadline,
    async () => {
      const collectionName = 'guest_stay_summary';
      const eventStoreWithoutProjections = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'None', databaseSchemaName },
      });
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'None', databaseSchemaName },
        projections: [
          {
            type: 'async',
            projection: guestStaySummaryProjection(collectionName),
          },
        ],
      });

      try {
        await eventStoreWithoutProjections.schema.migrate();

        const consumer = eventStore.consumer<GuestStayEvent>({
          stopWhen: { noMessagesLeft: true },
          schema: { autoMigration: 'CreateOrUpdate' },
        });
        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }
      } finally {
        await eventStoreWithoutProjections.close();
        await eventStore.close();
      }

      assertTrue(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName: collectionName }),
        ),
      );
    },
  );

  void it(
    "fails to start the consumer when the store's projection migrations are pending and the store ensures migrations",
    withDeadline,
    async () => {
      const collectionName = 'guest_stay_summary';
      const eventStoreWithoutProjections = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'None', databaseSchemaName },
      });
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'EnsureMigrated', databaseSchemaName },
        projections: [
          {
            type: 'async',
            projection: guestStaySummaryProjection(collectionName),
          },
        ],
      });

      try {
        await eventStoreWithoutProjections.schema.migrate();

        const consumer = eventStore.consumer<GuestStayEvent>({
          stopWhen: { noMessagesLeft: true },
        });
        try {
          await assertRejects(
            consumer.start(),
            (error) =>
              error instanceof PendingMigrationsError &&
              error.pendingMigrations.some(({ name }) =>
                name.includes(collectionName),
              ),
          );
        } finally {
          await consumer.close();
        }
      } finally {
        await eventStoreWithoutProjections.close();
        await eventStore.close();
      }

      assertFalse(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName: collectionName }),
        ),
      );
    },
  );

  void it(
    "migrates the store's projections when its consumer runs only the user's own processors",
    withDeadline,
    async () => {
      const collectionName = 'guest_stay_summary';
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'CreateOrUpdate', databaseSchemaName },
        projections: [
          {
            type: 'async',
            projection: guestStaySummaryProjection(collectionName),
          },
        ],
      });

      try {
        const consumer = eventStore.consumer<GuestStayEvent>({
          stopWhen: { noMessagesLeft: true },
          processors: [
            inMemoryReactor<GuestStayEvent>({
              processorId: `processor:${uuid()}`,
              eachMessage: () => {},
            }),
          ],
        });
        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }

        assertTrue(
          await tableExists(
            pool.execute,
            sqliteTableName({ databaseSchemaName, tableName: collectionName }),
          ),
        );
        assertDeepEqual((await eventStore.schema.migrate()).applied, []);
      } finally {
        await eventStore.close();
      }
    },
  );

  void it(
    "creates the event store schema and its projectors' projections when a consumer created without the store starts",
    withDeadline,
    async () => {
      const collectionName = 'guest_stay_summary';
      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
        stopWhen: { noMessagesLeft: true },
        schema: { databaseSchemaName },
      });
      consumer.projector({
        processorId: `processor:${uuid()}`,
        projection: guestStaySummaryProjection(collectionName),
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      assertTrue(
        await tableExists(
          pool.execute,
          sqliteTableName({
            databaseSchemaName,
            tableName: messagesTable.name,
          }),
        ),
      );
      assertTrue(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName: collectionName }),
        ),
      );
    },
  );

  void it(
    "creates no event store schema when one of its projectors' projections fails to migrate",
    withDeadline,
    async () => {
      const tableName = 'guest_stays';
      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
        stopWhen: { noMessagesLeft: true },
        schema: { databaseSchemaName },
      });
      consumer.projector({
        processorId: `processor:${uuid()}`,
        projection: sqliteRawSQLProjection<GuestCheckedIn>({
          name: tableName,
          canHandle: ['GuestCheckedIn'],
          migrations: [
            sqlMigration(`test:${tableName}:invalid`, [
              SQL`CREATE TABLE ${SQL.identifier(tableName)} (`,
            ]),
          ],
          evolve: () => SQL`SELECT 1;`,
        }),
      });

      try {
        await assertRejects(consumer.start());
      } finally {
        await consumer.close();
      }

      assertFalse(
        await tableExists(
          pool.execute,
          sqliteTableName({
            databaseSchemaName,
            tableName: messagesTable.name,
          }),
        ),
      );
    },
  );

  void it(
    'creates no event store schema when a projector with its own migration options fails to migrate its projection',
    withDeadline,
    async () => {
      const projectionsDatabaseSchemaName = 'read_models';
      const tableName = 'guest_stays';
      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
        stopWhen: { noMessagesLeft: true },
        schema: { databaseSchemaName },
      });
      consumer.projector({
        processorId: `processor:${uuid()}`,
        projection: sqliteRawSQLProjection<GuestCheckedIn>({
          name: tableName,
          canHandle: ['GuestCheckedIn'],
          migrations: [
            sqlMigration(`test:${tableName}:invalid`, [
              SQL`CREATE TABLE ${SQLTableReference.from({ databaseSchemaName: projectionsDatabaseSchemaName, tableName })} (`,
            ]),
          ],
          evolve: () => SQL`SELECT 1;`,
        }),
        migrationOptions: {
          databaseSchemaName,
          projectionsDatabaseSchemaName,
        },
      });

      try {
        await assertRejects(consumer.start());
      } finally {
        await consumer.close();
      }

      assertFalse(
        await tableExists(
          pool.execute,
          sqliteTableName({
            databaseSchemaName,
            tableName: messagesTable.name,
          }),
        ),
      );
    },
  );

  void it(
    'fails to start the consumer when a projector ensures migrations with its own migration options and its projection is not migrated',
    withDeadline,
    async () => {
      const collectionName = 'guest_stay_summary';
      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
        stopWhen: { noMessagesLeft: true },
        schema: { databaseSchemaName },
      });
      consumer.projector({
        processorId: `processor:${uuid()}`,
        projection: guestStaySummaryProjection(collectionName),
        migrationOptions: {
          databaseSchemaName,
          autoMigration: 'EnsureMigrated',
        },
      });

      try {
        await assertRejects(
          consumer.start(),
          (error) =>
            error instanceof PendingMigrationsError &&
            error.pendingMigrations.some(({ name }) =>
              name.includes(collectionName),
            ),
        );
      } finally {
        await consumer.close();
      }

      assertFalse(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName: collectionName }),
        ),
      );
    },
  );

  void it(
    'projects events when a projector ensures migrations with its own migration options and its projection is migrated',
    withDeadline,
    async () => {
      const collectionName = 'guest_stay_summary';
      const projection = guestStaySummaryProjection(collectionName);
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'None', databaseSchemaName },
        projections: [{ type: 'async', projection }],
      });

      try {
        await eventStore.schema.migrate();

        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
          schema: { databaseSchemaName },
        });
        consumer.projector({
          processorId: `processor:${uuid()}`,
          projection,
          migrationOptions: {
            databaseSchemaName,
            autoMigration: 'EnsureMigrated',
          },
        });

        void consumer.start();
        try {
          await consumer.whenStarted();

          await eventStore.appendToStream(`guestStay-${uuid()}`, [
            { type: 'GuestCheckedIn', data: { guestId: uuid() } },
          ]);

          await consumer.whenCaughtUp();
        } finally {
          await consumer.close();
        }

        assertEqual(1, await rowsInTable(databaseSchemaName, collectionName));
      } finally {
        await eventStore.close();
      }
    },
  );

  void it(
    "creates the reactor's tables in the event store schema when the event store's consumer starts",
    withDeadline,
    async () => {
      const tableName = 'sent_emails';
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'CreateOrUpdate', databaseSchemaName },
      });

      try {
        const consumer = eventStore.consumer<GuestStayEvent>({
          stopWhen: { noMessagesLeft: true },
        });
        consumer.reactor({
          processorId: `processor:${uuid()}`,
          schema: { definition: sentEmailsSchema(tableName) },
          eachMessage: () => {},
        });
        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }
      } finally {
        await eventStore.close();
      }

      assertTrue(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName }),
        ),
      );
      assertFalse(await tableExists(pool.execute, tableName));
    },
  );

  void it(
    "creates the reactor's tables in the event store schema together with it when a consumer created without the store starts",
    withDeadline,
    async () => {
      const tableName = 'sent_emails';
      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
        stopWhen: { noMessagesLeft: true },
        schema: { databaseSchemaName },
      });
      consumer.reactor({
        processorId: `processor:${uuid()}`,
        schema: { definition: sentEmailsSchema(tableName) },
        eachMessage: () => {},
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      assertTrue(
        await tableExists(
          pool.execute,
          sqliteTableName({
            databaseSchemaName,
            tableName: messagesTable.name,
          }),
        ),
      );
      assertTrue(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName }),
        ),
      );
    },
  );

  void it(
    "creates the reactor's tables in the schema that its component names",
    withDeadline,
    async () => {
      const emailsSchemaName = 'emails';
      const tableName = 'sent_emails';
      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
        stopWhen: { noMessagesLeft: true },
        schema: { databaseSchemaName },
      });
      consumer.reactor({
        processorId: `processor:${uuid()}`,
        schema: {
          definition: sentEmailsSchemaIn(emailsSchemaName, tableName),
        },
        eachMessage: () => {},
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      assertTrue(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName: emailsSchemaName, tableName }),
        ),
      );
      assertFalse(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName }),
        ),
      );
    },
  );

  void it(
    "creates the reactor's tables from the migrations the user provided",
    withDeadline,
    async () => {
      const tableName = 'sent_emails';
      const migrationName = `test:${tableName}:create`;
      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
        stopWhen: { noMessagesLeft: true },
        schema: { databaseSchemaName },
      });
      consumer.reactor({
        processorId: `processor:${uuid()}`,
        migrations: [
          sqlMigration(migrationName, [
            SQL`CREATE TABLE ${SQLTableReference.from({ databaseSchemaName, tableName })} (id TEXT PRIMARY KEY)`,
          ]),
        ],
        eachMessage: () => {},
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      assertTrue(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName }),
        ),
      );
      assertTrue(
        (await migrationNames(databaseSchemaName)).includes(migrationName),
      );
    },
  );

  void it(
    'creates no reactor tables when the consumer skips migrations',
    withDeadline,
    async () => {
      const tableName = 'sent_emails';
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'None', databaseSchemaName },
      });

      try {
        await eventStore.schema.migrate();

        const consumer = eventStore.consumer<GuestStayEvent>({
          stopWhen: { noMessagesLeft: true },
          schema: { autoMigration: 'None' },
        });
        consumer.reactor({
          processorId: `processor:${uuid()}`,
          schema: { definition: sentEmailsSchema(tableName) },
          eachMessage: () => {},
        });
        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }
      } finally {
        await eventStore.close();
      }

      assertFalse(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName }),
        ),
      );
    },
  );

  void it(
    "creates the reactor's tables when the reactor sets its own autoMigration and the event store skips migrations",
    withDeadline,
    async () => {
      const tableName = 'sent_emails';
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'None', databaseSchemaName },
      });

      try {
        await eventStore.schema.migrate();

        const consumer = eventStore.consumer<GuestStayEvent>({
          stopWhen: { noMessagesLeft: true },
        });
        consumer.reactor({
          processorId: `processor:${uuid()}`,
          schema: { definition: sentEmailsSchema(tableName) },
          migrationOptions: {
            databaseSchemaName,
            autoMigration: 'CreateOrUpdate',
          },
          eachMessage: () => {},
        });
        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }
      } finally {
        await eventStore.close();
      }

      assertTrue(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName }),
        ),
      );
    },
  );

  void it(
    'fails to start the consumer when a reactor ensures migrations and its tables are not migrated',
    withDeadline,
    async () => {
      const tableName = 'sent_emails';
      const migrationName = `test:${tableName}:create`;
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'None', databaseSchemaName },
      });

      try {
        await eventStore.schema.migrate();

        const consumer = eventStore.consumer<GuestStayEvent>({
          stopWhen: { noMessagesLeft: true },
          schema: { autoMigration: 'EnsureMigrated' },
        });
        consumer.reactor({
          processorId: `processor:${uuid()}`,
          migrations: [
            sqlMigration(migrationName, [
              SQL`CREATE TABLE ${SQLTableReference.from({ databaseSchemaName, tableName })} (id TEXT PRIMARY KEY)`,
            ]),
          ],
          eachMessage: () => {},
        });
        try {
          await assertRejects(
            consumer.start(),
            (error) =>
              error instanceof PendingMigrationsError &&
              error.pendingMigrations.some(
                ({ name }) => name === migrationName,
              ),
          );
        } finally {
          await consumer.close();
        }
      } finally {
        await eventStore.close();
      }

      assertFalse(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName }),
        ),
      );
    },
  );

  void it(
    "creates no event store schema when a reactor's tables fail to migrate",
    withDeadline,
    async () => {
      const tableName = 'sent_emails';
      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
        stopWhen: { noMessagesLeft: true },
        schema: { databaseSchemaName },
      });
      consumer.reactor({
        processorId: `processor:${uuid()}`,
        migrations: [
          sqlMigration(`test:${tableName}:invalid`, [
            SQL`CREATE TABLE ${SQLTableReference.from({ databaseSchemaName, tableName })} (`,
          ]),
        ],
        eachMessage: () => {},
      });

      try {
        await assertRejects(consumer.start());
      } finally {
        await consumer.close();
      }

      assertFalse(
        await tableExists(
          pool.execute,
          sqliteTableName({
            databaseSchemaName,
            tableName: messagesTable.name,
          }),
        ),
      );
    },
  );

  void it(
    "creates the workflow processor's tables in the event store schema together with it when a consumer created without the store starts",
    withDeadline,
    async () => {
      const tableName = 'group_checkouts';
      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
        stopWhen: { noMessagesLeft: true },
        schema: { databaseSchemaName },
      });
      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        schema: { definition: sentEmailsSchema(tableName) },
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      assertTrue(
        await tableExists(
          pool.execute,
          sqliteTableName({
            databaseSchemaName,
            tableName: messagesTable.name,
          }),
        ),
      );
      assertTrue(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName }),
        ),
      );
    },
  );

  void it(
    'creates no workflow processor tables when the consumer skips migrations',
    withDeadline,
    async () => {
      const tableName = 'group_checkouts';
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'None', databaseSchemaName },
      });

      try {
        await eventStore.schema.migrate();

        const consumer = eventStore.consumer({
          stopWhen: { noMessagesLeft: true },
          schema: { autoMigration: 'None' },
        });
        consumer.workflowProcessor<
          GroupCheckoutInput,
          GroupCheckout,
          GroupCheckoutOutput
        >({
          ...workflowProcessorOptions,
          schema: { definition: sentEmailsSchema(tableName) },
        });
        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }
      } finally {
        await eventStore.close();
      }

      assertFalse(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName }),
        ),
      );
    },
  );

  const dropTableWithMigrations = async (
    databaseSchemaName: string,
    tableName: string,
  ): Promise<void> => {
    await pool.execute.command(
      SQL`DROP TABLE ${SQLTableReference.from({ databaseSchemaName, tableName })}`,
    );
    await pool.execute.command(
      SQL`DELETE FROM ${SQLTableReference.from({ databaseSchemaName, tableName: 'dmb_migrations' })} WHERE name LIKE ${`%${tableName}%`}`,
    );
  };

  const rowsInTable = (
    databaseSchemaName: string,
    tableName: string,
  ): Promise<number> =>
    count(
      pool.execute.query<{ count: number }>(
        SQL`SELECT COUNT(*) AS count FROM ${SQLTableReference.from({ databaseSchemaName, tableName })}`,
      ),
    );

  const migrationNames = async (
    databaseSchemaName: string,
  ): Promise<string[]> => {
    const result = await pool.execute.query<{ name: string }>(
      SQL`SELECT name FROM ${SQLTableReference.from({ databaseSchemaName, tableName: 'dmb_migrations' })}`,
    );

    return result.rows.map((row) => row.name);
  };

  const messagesInStream = (streamName: string): Promise<number> =>
    count(
      pool.execute.query<{ count: number }>(
        SQL`
          SELECT COUNT(*) AS count
          FROM ${SQLTableReference.from({
            databaseSchemaName,
            tableName: messagesTable.name,
          })}
          WHERE stream_id = ${streamName}
        `,
      ),
    );
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;

type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;

type GuestStaySummary = { checkedInCount: number };

const sentEmailsTables = (tableName: string) => ({
  sentEmails: table(tableName, {
    columns: {
      id: column('id', Text, { primaryKey: true, notNull: true }),
    },
  }),
});

const sentEmailsSchema = (tableName: string) =>
  dumboSchema.database({ tables: sentEmailsTables(tableName) });

const sentEmailsSchemaIn = (databaseSchemaName: string, tableName: string) =>
  dumboSchema.schema(databaseSchemaName, sentEmailsTables(tableName));

const guestStaySummaryProjection = (collectionName: string) =>
  pongoSingleStreamProjection<GuestStaySummary, GuestCheckedIn>({
    collectionName,
    canHandle: ['GuestCheckedIn'],
    evolve: (document: GuestStaySummary) => ({
      checkedInCount: document.checkedInCount + 1,
    }),
    initialState: () => ({ checkedInCount: 0 }),
  });
