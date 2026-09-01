import { sqlMigration, type SQLMigration } from '@event-driven-io/dumbo';
import {
  eventStoreDatabaseSchema,
  type EventStoreDatabaseSchemaOptions,
} from '../eventStoreDatabaseSchema';
import { eventStoreSchemaSQL, schemaSQL } from '../eventStoreSchemaSQL';
import { migrations_0_42_0 } from './0_42_0';

export * from './0_41_0';
export * from './0_42_0';

export { eventStoreSchemaSQL, schemaSQL };

export const currentSQLiteEventStoreSchemaVersion = '0.42.0';

export const schemaMigrationFor = (
  options?: EventStoreDatabaseSchemaOptions,
): SQLMigration =>
  sqlMigration('emt:sqlite:eventstore:initial', eventStoreSchemaSQL(options), {
    ignoreHashMismatch: true,
  });

export const schemaMigration = schemaMigrationFor();

export const pastEventStoreSchemaMigrations: SQLMigration[] = [
  ...migrations_0_42_0,
];

export const eventStoreSchemaMigrations: SQLMigration[] = [
  ...pastEventStoreSchemaMigrations,
  schemaMigration,
];

export const eventStoreSchemaMigrationsFor = (
  options?: EventStoreDatabaseSchemaOptions,
): SQLMigration[] => {
  const { databaseSchemaName } = eventStoreDatabaseSchema(options);

  return databaseSchemaName === undefined
    ? eventStoreSchemaMigrations
    : [schemaMigrationFor(options)];
};
