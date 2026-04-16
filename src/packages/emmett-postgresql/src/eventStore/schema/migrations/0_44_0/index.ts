import { dumbo, SQL } from '@event-driven-io/dumbo';

export const dropOldReleaseLockOverloadSQL = SQL`
DROP FUNCTION IF EXISTS emt_release_processor_lock(BIGINT, TEXT, TEXT, INT, TEXT, TEXT);
`;

export const dropOldReleaseLockOverload = async (connectionString: string) => {
  const pool = dumbo({ connectionString });

  try {
    await pool.withTransaction(async ({ execute }) => {
      await execute.command(dropOldReleaseLockOverloadSQL);
    });
  } finally {
    await pool.close();
  }
};
