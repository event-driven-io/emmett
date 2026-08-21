import { sqlMigration, type SQLMigration } from '@event-driven-io/dumbo';
import {
  eventStoreDatabaseSchema,
  type EventStoreDatabaseSchemaOptions,
} from '../eventStoreDatabaseSchema';
import { eventStoreSchemaSQL, schemaSQL } from '../eventStoreSchemaSQL';
import { migrations_0_38_7 } from './0_38_7';
import { migrations_0_42_0 } from './0_42_0';
import { migrations_0_43_0 } from './0_43_0';

export { eventStoreSchemaSQL, schemaSQL };

export const currentPostgreSQLEventStoreSchemaVersion = '0.43.0';

export const schemaMigrationFor = (
  options?: EventStoreDatabaseSchemaOptions,
): SQLMigration =>
  sqlMigration(
    'emt:postgresql:eventstore:initial',
    eventStoreSchemaSQL(options),
    { ignoreHashMismatch: true },
  );

export const schemaMigration = schemaMigrationFor();

export const pastEventStoreSchemaMigrations: SQLMigration[] = [
  ...migrations_0_38_7,
  ...migrations_0_42_0,
  ...migrations_0_43_0,
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
