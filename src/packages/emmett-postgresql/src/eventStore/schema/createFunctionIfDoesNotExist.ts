import { rawSql } from '@event-driven-io/dumbo';

export const createFunctionIfDoesNotExistSQL = (
  functionName: string,
  functionDefinition: string,
) =>
  rawSql(
    `
DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = '${functionName}') THEN
  ${functionDefinition}
END IF;
END $$;
`,
  );
