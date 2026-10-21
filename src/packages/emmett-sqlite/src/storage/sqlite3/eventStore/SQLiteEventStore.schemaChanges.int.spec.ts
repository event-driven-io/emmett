import {
  count,
  PendingMigrationsError,
  SQL,
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
  assertRejects,
  assertTrue,
  type Event,
} from '@event-driven-io/emmett';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { getSQLiteEventStore } from '../../../eventStore/SQLiteEventStore';
import { pongoSingleStreamProjection } from '../../../eventStore/projections';
import { sqlite3EventStoreDriver } from '../../../sqlite3';
import { deleteSQLiteDatabaseFiles } from '../testing/sqliteTestDatabase';

const withDeadline = { timeout: 30000 };

void describe('SQLite event store schema changes after the user migrated the schema', () => {
  const testDatabasePath = path.dirname(fileURLToPath(import.meta.url));
  const fileName = path.resolve(testDatabasePath, 'schema-changes.db');
  const databaseSchemaName = 'events';

  let pool: SQLitePool<SQLite3Connection>;

  beforeEach(() => {
    pool = sqlite3Pool({ fileName });
  });

  afterEach(async () => {
    await pool.close();
    deleteSQLiteDatabaseFiles(fileName);
  });

  void it(
    'projects events without schema changes when the user migrated the schema and the event store skips migrations',
    withDeadline,
    async () => {
      const collectionName = 'guest_stay_summary';
      const projection = guestStaySummaryProjection(collectionName);
      await migrate(projection);

      const schemaChanges = await schemaChangesDuring(async () => {
        const eventStore = getSQLiteEventStore({
          driver: sqlite3EventStoreDriver,
          fileName,
          schema: { autoMigration: 'None', databaseSchemaName },
          projections: [{ type: 'async', projection }],
        });
        try {
          await projectEvent(eventStore);
        } finally {
          await eventStore.close();
        }
      });

      assertDeepEqual([], schemaChanges);
      assertEqual(1, await rowsInTable(collectionName));
    },
  );

  void it(
    'projects events without schema changes when the user migrated the schema and the event store creates or updates migrations',
    withDeadline,
    async () => {
      const collectionName = 'guest_stay_summary';
      const projection = guestStaySummaryProjection(collectionName);
      await migrate(projection);

      const schemaChanges = await schemaChangesDuring(async () => {
        const eventStore = getSQLiteEventStore({
          driver: sqlite3EventStoreDriver,
          fileName,
          schema: { autoMigration: 'CreateOrUpdate', databaseSchemaName },
          projections: [{ type: 'async', projection }],
        });
        try {
          await projectEvent(eventStore);
        } finally {
          await eventStore.close();
        }
      });

      assertDeepEqual([], schemaChanges);
      assertEqual(1, await rowsInTable(collectionName));
    },
  );

  void it(
    'starts the consumer without schema changes when projection migrations are pending and the event store skips migrations',
    withDeadline,
    async () => {
      const collectionName = 'guest_stay_summary';
      await migrate();

      const schemaChanges = await schemaChangesDuring(async () => {
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
          const consumer = eventStore.consumer<GuestCheckedIn>({
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
      });

      assertDeepEqual([], schemaChanges);
      assertFalse(await collectionExists(collectionName));
    },
  );

  void it(
    'fails to start the consumer without schema changes when projection migrations are pending and the event store ensures migrations',
    withDeadline,
    async () => {
      const collectionName = 'guest_stay_summary';
      await migrate();

      const schemaChanges = await schemaChangesDuring(async () => {
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
          const consumer = eventStore.consumer<GuestCheckedIn>({
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
          await eventStore.close();
        }
      });

      assertDeepEqual([], schemaChanges);
    },
  );

  void it(
    'lists pending projection migrations without schema changes when the user runs a diff dry run',
    withDeadline,
    async () => {
      const collectionName = 'guest_stay_summary';
      let pendingMigrationNames: string[] = [];

      const schemaChanges = await schemaChangesDuring(async () => {
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
          const result = await eventStore.schema.migrate({ dryRun: 'diff' });
          pendingMigrationNames = result.applied.map(({ name }) => name);
        } finally {
          await eventStore.close();
        }
      });

      assertDeepEqual([], schemaChanges);
      assertTrue(
        pendingMigrationNames.some((name) => name.includes(collectionName)),
      );
      assertFalse(await collectionExists(collectionName));
    },
  );

  const migrate = async (
    projection?: ReturnType<typeof guestStaySummaryProjection>,
  ) => {
    const eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName,
      schema: { autoMigration: 'None', databaseSchemaName },
      projections: projection ? [{ type: 'async', projection }] : [],
    });
    try {
      await eventStore.schema.migrate();
    } finally {
      await eventStore.close();
    }
  };

  const schemaChangesDuring = async (
    action: () => Promise<void>,
  ): Promise<string[]> => {
    const before = await schemaObjects();
    await action();
    const after = await schemaObjects();
    return [
      ...after.filter((object) => !before.includes(object)),
      ...before.filter((object) => !after.includes(object)),
    ];
  };

  const schemaObjects = async (): Promise<string[]> =>
    (
      await pool.execute.query<{
        type: string;
        name: string;
        sql: string | null;
      }>(SQL`SELECT type, name, sql FROM sqlite_master`)
    ).rows.map(({ type, name, sql }) => `${type} ${name}: ${sql ?? ''}`);

  const projectEvent = async (
    eventStore: ReturnType<typeof getSQLiteEventStore>,
  ) => {
    const consumer = eventStore.consumer<GuestCheckedIn>();

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
  };

  const collectionExists = (collectionName: string): Promise<boolean> =>
    tableExists(
      pool.execute,
      sqliteTableName({ databaseSchemaName, tableName: collectionName }),
    );

  const rowsInTable = (tableName: string): Promise<number> =>
    count(
      pool.execute.query<{ count: number }>(
        SQL`SELECT COUNT(*) AS count FROM ${SQLTableReference.from({ databaseSchemaName, tableName })}`,
      ),
    );
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;

type GuestStaySummary = { checkedInCount: number };

const guestStaySummaryProjection = (collectionName: string) =>
  pongoSingleStreamProjection<GuestStaySummary, GuestCheckedIn>({
    collectionName,
    canHandle: ['GuestCheckedIn'],
    evolve: (document: GuestStaySummary) => ({
      checkedInCount: document.checkedInCount + 1,
    }),
    initialState: () => ({ checkedInCount: 0 }),
  });
