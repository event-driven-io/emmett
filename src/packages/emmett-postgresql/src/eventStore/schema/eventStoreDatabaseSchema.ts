import type { MigrationTableOptions } from '@event-driven-io/dumbo';

export type EventStoreDatabaseSchemaOptions = {
  databaseSchemaName?: string | undefined;
  projectionsDatabaseSchemaName?: string | undefined;
  migrationTable?: MigrationTableOptions | undefined;
};

export type EventStoreDatabaseSchema = {
  databaseSchemaName: string | undefined;
  projectionsDatabaseSchemaName: string | undefined;
  migrationTable: MigrationTableOptions | undefined;
};

export const eventStoreDatabaseSchema = (
  options?: EventStoreDatabaseSchemaOptions,
): EventStoreDatabaseSchema => {
  const databaseSchemaName = options?.databaseSchemaName;
  const projectionsDatabaseSchemaName =
    options?.projectionsDatabaseSchemaName ?? databaseSchemaName;
  const migrationTableSchemaName =
    options?.migrationTable?.schemaName ?? databaseSchemaName;
  const migrationTableName = options?.migrationTable?.tableName;
  const migrationTable =
    migrationTableSchemaName === undefined && migrationTableName === undefined
      ? undefined
      : {
          ...(migrationTableSchemaName === undefined
            ? {}
            : { schemaName: migrationTableSchemaName }),
          ...(migrationTableName === undefined
            ? {}
            : { tableName: migrationTableName }),
        };

  return {
    databaseSchemaName,
    projectionsDatabaseSchemaName,
    migrationTable,
  };
};
