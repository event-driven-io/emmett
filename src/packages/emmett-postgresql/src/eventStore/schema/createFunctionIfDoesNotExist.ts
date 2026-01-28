import { SQL } from '@event-driven-io/dumbo';

export const createFunctionIfDoesNotExistSQL = (
  functionName: string,
  functionDefinition: SQL,
) =>
  SQL`
DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = '${functionName}') THEN
  ${functionDefinition}
END IF;
END $$;
`;
