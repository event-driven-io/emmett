import type { MigrationTableOptions } from '@event-driven-io/dumbo';

export type EventStoreDatabaseSchemaOptions = {
  databaseSchemaName?: string | undefined;
  projectionsDatabaseSchemaName?: string | undefined;
  migrationTableDatabaseSchemaName?: string | undefined;
};

export type EventStoreDatabaseSchema = {
  databaseSchemaName: string | undefined;
  projectionsDatabaseSchemaName: string | undefined;
  migrationTable: MigrationTableOptions | undefined;
  isDefaultSchema: boolean;
};

export const eventStoreDatabaseSchema = (
  options?: EventStoreDatabaseSchemaOptions,
): EventStoreDatabaseSchema => {
  const databaseSchemaName = options?.databaseSchemaName;
  const projectionsDatabaseSchemaName =
    options?.projectionsDatabaseSchemaName ?? databaseSchemaName;
  const migrationTableDatabaseSchemaName =
    options?.migrationTableDatabaseSchemaName ?? databaseSchemaName;

  return {
    databaseSchemaName,
    projectionsDatabaseSchemaName,
    migrationTable:
      migrationTableDatabaseSchemaName === undefined
        ? undefined
        : { schemaName: migrationTableDatabaseSchemaName },
    isDefaultSchema: databaseSchemaName === undefined,
  };
};
