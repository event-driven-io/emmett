import { SQL } from '@event-driven-io/dumbo';

const functionSchemaName = (databaseSchemaName: string | undefined) =>
  databaseSchemaName === undefined
    ? SQL`current_schema()`
    : SQL.literal(databaseSchemaName);

export const createFunctionIfDoesNotExistSQL = (
  functionName: string,
  functionDefinition: SQL,
  databaseSchemaName?: string,
) => SQL`
DO $$
BEGIN
IF NOT EXISTS (
  SELECT 1
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = ${functionSchemaName(databaseSchemaName)}
    AND p.proname = '${SQL.plain(functionName)}'
) THEN
  ${functionDefinition}
END IF;
END $$;
`;
