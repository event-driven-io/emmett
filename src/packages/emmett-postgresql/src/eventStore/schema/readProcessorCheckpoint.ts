import { singleOrNull, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import { defaultTag, processorsTable } from './typing';

type ReadProcessorCheckpointSqlResult = {
  last_processed_checkpoint: string;
};

export type ReadProcessorCheckpointResult = {
  lastProcessedCheckpoint: bigint | null;
};

export const readProcessorCheckpoint = async (
  execute: SQLExecutor,
  options: { processorId: string; partition?: string },
): Promise<ReadProcessorCheckpointResult> => {
  const result = await singleOrNull(
    execute.query<ReadProcessorCheckpointSqlResult>(
      sql(
        `SELECT last_processed_checkpoint
           FROM ${processorsTable.name}
           WHERE partition = %L AND processor_id = %L
           LIMIT 1`,
        options?.partition ?? defaultTag,
        options.processorId,
      ),
    ),
  );

  return {
    lastProcessedCheckpoint:
      result !== null ? BigInt(result.last_processed_checkpoint) : null,
  };
};
