import { sqlMigration, type SQLMigration } from '@event-driven-io/dumbo';
import { schemaSQL } from '../tables';
import { migrations_0_42_0 } from './0_42_0';

export * from './0_41_0';
export * from './0_42_0';

export const currentSQLiteEventStoreSchemaVersion = '0.43.0';

export const schemaMigration: SQLMigration = sqlMigration(
  'emt:sqlite:eventstore:initial',
  schemaSQL,
  { ignoreHashMismatch: true },
);

export const pastEventStoreSchemaMigrations: SQLMigration[] = [
  ...migrations_0_42_0,
];

export const eventStoreSchemaMigrations: SQLMigration[] = [
  ...pastEventStoreSchemaMigrations,
  schemaMigration,
];
