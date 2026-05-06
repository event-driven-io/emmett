import { singleOrNull, SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import type { PostgreSQLEventStoreCheckpoint } from './readMessagesBatch';
import { defaultTag, messagesTable } from './typing';

type ReadLastMessageGlobalPositionSqlResult = {
  transaction_id: string;
  global_position: string;
};

export type ReadLastMessageGlobalPositionResult = {
  currentGlobalPosition: PostgreSQLEventStoreCheckpoint | null;
};

export const readLastMessageGlobalPosition = async (
  execute: SQLExecutor,
  options?: { partition?: string },
): Promise<ReadLastMessageGlobalPositionResult> => {
  const result = await singleOrNull(
    execute.query<ReadLastMessageGlobalPositionSqlResult>(
      SQL`SELECT transaction_id, global_position
           FROM ${SQL.identifier(messagesTable.name)}
           WHERE partition = ${options?.partition ?? defaultTag} AND is_archived = FALSE AND transaction_id < pg_snapshot_xmin(pg_current_snapshot())
           ORDER BY transaction_id DESC, global_position DESC
           LIMIT 1`,
    ),
  );

  return {
    currentGlobalPosition:
      result !== null
        ? {
            transactionId: result.transaction_id,
            globalPosition: BigInt(result.global_position),
          }
        : null,
  };
};
