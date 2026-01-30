import { singleOrNull, SQL, type SQLExecutor } from '@event-driven-io/dumbo';
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
      SQL`SELECT last_processed_checkpoint
           FROM ${SQL.identifier(processorsTable.name)}
           WHERE partition = ${options?.partition ?? defaultTag} AND processor_id = ${options.processorId} AND version = ${options.version ?? 1}
           LIMIT 1`,
    ),
  );

  return {
    lastProcessedCheckpoint:
      result !== null ? BigInt(result.last_processed_checkpoint) : null,
  };
};
