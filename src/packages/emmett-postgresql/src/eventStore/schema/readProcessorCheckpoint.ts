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
  options: { processorId: string; partition?: string; version?: number },
): Promise<ReadProcessorCheckpointResult> => {
  const result = await singleOrNull(
    execute.query<ReadProcessorCheckpointSqlResult>(
      sql(
        `SELECT last_processed_checkpoint
           FROM ${processorsTable.name}
           WHERE partition = %L AND processor_id = %L AND version = %s
           LIMIT 1`,
        options?.partition ?? defaultTag,
        options.processorId,
        options.version ?? 1,
      ),
    ),
  );

  return {
    lastProcessedCheckpoint:
      result !== null ? BigInt(result.last_processed_checkpoint) : null,
  };
};
