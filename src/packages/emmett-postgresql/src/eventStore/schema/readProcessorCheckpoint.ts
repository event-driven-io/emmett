import { singleOrNull, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import { defaultTag, subscriptionsTable } from './typing';

type ReadProcessorCheckpointSqlResult = {
  last_processed_position: string;
};

export type ReadProcessorCheckpointResult = {
  lastProcessedPosition: bigint | null;
};

export const readProcessorCheckpoint = async (
  execute: SQLExecutor,
  options: { processorId: string; partition?: string },
): Promise<ReadProcessorCheckpointResult> => {
  const result = await singleOrNull(
    execute.query<ReadProcessorCheckpointSqlResult>(
      sql(
        `SELECT last_processed_position
           FROM ${subscriptionsTable.name}
           WHERE partition = %L AND subscription_id = %L
           LIMIT 1`,
        options?.partition ?? defaultTag,
        options.processorId,
      ),
    ),
  );

  return {
    lastProcessedPosition:
      result !== null ? BigInt(result.last_processed_position) : null,
  };
};
