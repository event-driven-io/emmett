import { SQL, type SQL as SQLStatement } from '@event-driven-io/dumbo';

export const postgreSQLFunctionName = (
  databaseSchemaName: string | undefined,
  functionName: string,
): SQLStatement =>
  databaseSchemaName === undefined
    ? SQL`${SQL.plain(functionName)}`
    : SQL`${SQL.identifier(databaseSchemaName)}.${SQL.identifier(functionName)}`;
