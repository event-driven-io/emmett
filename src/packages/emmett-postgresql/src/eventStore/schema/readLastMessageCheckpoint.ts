import { singleOrNull, SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import type { PostgreSQLEventStoreCheckpoint } from './readMessagesBatch';
import { defaultTag, messagesTable } from './typing';

type ReadLastMessageCheckpointSqlResult = {
  transaction_id: string;
  global_position: string;
};

export type ReadLastMessageCheckpointResult = {
  currentCheckpoint: PostgreSQLEventStoreCheckpoint | null;
};

export const readLastMessageCheckpoint = async (
  execute: SQLExecutor,
  options?: { partition?: string },
): Promise<ReadLastMessageCheckpointResult> => {
  const result = await singleOrNull(
    execute.query<ReadLastMessageCheckpointSqlResult>(
      SQL`SELECT transaction_id, global_position
           FROM ${SQL.identifier(messagesTable.name)}
           WHERE partition = ${options?.partition ?? defaultTag} AND is_archived = FALSE AND transaction_id < pg_snapshot_xmin(pg_current_snapshot())
           ORDER BY transaction_id DESC, global_position DESC
           LIMIT 1`,
    ),
  );

  return {
    currentCheckpoint:
      result !== null
        ? {
            transactionId: BigInt(result.transaction_id),
            globalPosition: BigInt(result.global_position),
          }
        : null,
  };
};
