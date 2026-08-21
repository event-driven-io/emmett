import { singleOrNull, SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import type { PostgreSQLEventStoreCheckpoint } from './readMessagesBatch';
import { defaultTag, emmettRelation, messagesTable } from './typing';

type ReadLastMessageCheckpointSqlResult = {
  transaction_id: string;
  global_position: string;
};

export type ReadLastMessageCheckpointResult = {
  currentCheckpoint: PostgreSQLEventStoreCheckpoint | null;
};

export const readLastCommittedMessageCheckpoint = async (
  execute: SQLExecutor,
  options?: { partition?: string; databaseSchemaName?: string },
): Promise<ReadLastMessageCheckpointResult> => {
  const result = await singleOrNull(
    execute.query<ReadLastMessageCheckpointSqlResult>(
      SQL`SELECT transaction_id, global_position
           FROM ${emmettRelation(options?.databaseSchemaName, messagesTable.name)}
           WHERE partition = ${options?.partition ?? defaultTag} AND is_archived = FALSE
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
