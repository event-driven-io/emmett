import {
  dumbo,
  runSQLMigrations,
  type Dumbo,
  type MigrationDryRun,
  type RunSQLMigrationsResult,
  type SQL,
} from '@event-driven-io/dumbo';
import { pgEventStoreDriver, type PgEventStoreDriverOptions } from '../../pg';
import type { PostgreSQLEventStoreConsumerConnectionOptions } from '../consumers/postgreSQLEventStoreConsumer';
import type { AnyPostgreSQLEventStoreDriver } from '../eventStoreDriver';
import {
  eventStoreDatabaseSchema,
  type EventStoreDatabaseSchemaOptions,
} from './eventStoreDatabaseSchema';
import { numericMessageSchemaVersionMigrationFor } from './migrations/numericMessageSchemaVersionMigration';

const migrationName =
  'emt:postgresql:eventstore:0.43.0:numeric-message-schema-version';

export type MigrateSchemaToNumericMessageSchemaVersionOptions<
  Driver extends AnyPostgreSQLEventStoreDriver = AnyPostgreSQLEventStoreDriver,
> = PostgreSQLEventStoreConsumerConnectionOptions<never, Driver> &
  EventStoreDatabaseSchemaOptions & {
    messageSchemaVersionMapping?: SQL | undefined;
    dryRun?: MigrationDryRun | undefined;
    migrationTimeoutMS?: number | undefined;
  };

export const migrateSchemaToNumericMessageSchemaVersion = async <
  Driver extends AnyPostgreSQLEventStoreDriver = AnyPostgreSQLEventStoreDriver,
>(
  options: MigrateSchemaToNumericMessageSchemaVersionOptions<Driver>,
): Promise<RunSQLMigrationsResult> => {
  const databaseSchema = eventStoreDatabaseSchema(options);
  const isOwnPool = !options.pool;
  const pool = (options.pool ??
    dumbo(
      (options.driver ?? pgEventStoreDriver).mapToDumboOptions(
        options as PgEventStoreDriverOptions,
      ) as Parameters<typeof dumbo>[0],
    )) as Dumbo;

  const migration = numericMessageSchemaVersionMigrationFor(migrationName, {
    databaseSchemaName: databaseSchema.databaseSchemaName,
    messageSchemaVersionMapping: options.messageSchemaVersionMapping,
  });

  try {
    return await runSQLMigrations(pool, [migration], {
      migrationTable: databaseSchema.migrationTable,
      dryRun: options.dryRun,
      migrationTimeoutMS: options.migrationTimeoutMS,
    });
  } finally {
    if (isOwnPool) await pool.close();
  }
};
