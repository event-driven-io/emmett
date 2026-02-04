import { SQL, type SQLExecutor, singleOrNull } from '@event-driven-io/dumbo';
import { defaultTag, processorsTable } from './typing';
const { identifier } = SQL;

type ReadProcessorCheckpointSqlResult = {
  last_processed_checkpoint: string;
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
      SQL`SELECT last_processed_checkpoint
           FROM ${identifier(processorsTable.name)}
           WHERE partition = ${options?.partition ?? defaultTag} AND processor_id = ${options.processorId}
           LIMIT 1`,
    ),
  );

  return {
    lastProcessedPosition:
      result !== null ? BigInt(result.last_processed_checkpoint) : null,
  };
};
