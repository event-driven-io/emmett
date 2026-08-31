import { exists, SQL, type SQLExecutor } from '@event-driven-io/dumbo';

// TODO: Remove those helpers once Dumbo supports existence checks with a schema name

const schemaNameOrCurrent = (databaseSchemaName: string | undefined) =>
  databaseSchemaName === undefined
    ? SQL`current_schema()`
    : SQL`${databaseSchemaName}`;

export const schemaExists = (
  execute: SQLExecutor,
  databaseSchemaName: string,
): Promise<boolean> =>
  exists(
    execute.query<{ exists: boolean }>(SQL`
      SELECT EXISTS (
        SELECT FROM information_schema.schemata
        WHERE schema_name = ${databaseSchemaName}
      ) AS exists`),
  );

export const tableExists = (
  execute: SQLExecutor,
  tableName: string,
  databaseSchemaName?: string,
): Promise<boolean> =>
  exists(
    execute.query<{ exists: boolean }>(SQL`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = ${schemaNameOrCurrent(databaseSchemaName)}
          AND table_name = ${tableName}
      ) AS exists`),
  );

export const functionExists = (
  execute: SQLExecutor,
  functionName: string,
  databaseSchemaName?: string,
): Promise<boolean> =>
  exists(
    execute.query<{ exists: boolean }>(SQL`
      SELECT EXISTS (
        SELECT FROM pg_proc
        JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
        WHERE pg_namespace.nspname = ${schemaNameOrCurrent(databaseSchemaName)}
          AND pg_proc.proname = ${functionName}
      ) AS exists`),
  );

export const sequenceExists = (
  execute: SQLExecutor,
  sequenceName: string,
  databaseSchemaName?: string,
): Promise<boolean> =>
  exists(
    execute.query<{ exists: boolean }>(SQL`
      SELECT EXISTS (
        SELECT FROM information_schema.sequences
        WHERE sequence_schema = ${schemaNameOrCurrent(databaseSchemaName)}
          AND sequence_name = ${sequenceName}
      ) AS exists`),
  );

export const indexExists = (
  execute: SQLExecutor,
  indexName: string,
  databaseSchemaName?: string,
): Promise<boolean> =>
  exists(
    execute.query<{ exists: boolean }>(SQL`
      SELECT EXISTS (
        SELECT FROM pg_indexes
        WHERE schemaname = ${schemaNameOrCurrent(databaseSchemaName)}
          AND indexname = ${indexName}
      ) AS exists`),
  );
