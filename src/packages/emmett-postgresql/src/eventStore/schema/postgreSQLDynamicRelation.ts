import { SQL, type SQL as SQLStatement } from '@event-driven-io/dumbo';

export const postgreSQLDynamicRelationFormat = (
  databaseSchemaName: string | undefined,
): SQLStatement =>
  databaseSchemaName === undefined
    ? SQL`${SQL.plain('%I')}`
    : SQL`${SQL.plain('%I.%I')}`;

export const postgreSQLDynamicRelationArguments = (
  databaseSchemaName: string | undefined,
): SQLStatement =>
  databaseSchemaName === undefined
    ? SQL.EMPTY
    : SQL`${SQL.literal(databaseSchemaName)},`;
