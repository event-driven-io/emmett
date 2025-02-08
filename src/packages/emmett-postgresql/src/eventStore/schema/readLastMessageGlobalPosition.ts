import { singleOrNull, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import { defaultTag, messagesTable } from './typing';

type ReadLastMessageGlobalPositionSqlResult = {
  global_position: string;
};

export type ReadLastMessageGlobalPositionResult = {
  currentGlobalPosition: bigint | null;
};

export const readLastMessageGlobalPosition = async (
  execute: SQLExecutor,
  options?: { partition?: string },
): Promise<ReadLastMessageGlobalPositionResult> => {
  const result = await singleOrNull(
    execute.query<ReadLastMessageGlobalPositionSqlResult>(
      sql(
        `SELECT global_position
           FROM ${messagesTable.name}
           WHERE partition = %L AND is_archived = FALSE AND transaction_id < pg_snapshot_xmin(pg_current_snapshot())
           ORDER BY transaction_id, global_position
           LIMIT 1`,
        options?.partition ?? defaultTag,
      ),
    ),
  );

  return {
    currentGlobalPosition:
      result !== null ? BigInt(result.global_position) : null,
  };
};
