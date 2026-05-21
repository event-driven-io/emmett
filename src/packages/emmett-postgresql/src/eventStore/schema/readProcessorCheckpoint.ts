import {
  single,
  singleOrNull,
  SQL,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import type { ProcessorCheckpoint } from '@event-driven-io/emmett';
import { PostgreSQLEventStoreCheckpoint } from './readMessagesBatch';
import { defaultTag, messagesTable, processorsTable } from './typing';

type ReadProcessorCheckpointSqlResult = {
  last_processed_checkpoint: string;
};

type ReadTransactionIdSqlResult = {
  transaction_id: string;
};

export type ReadProcessorCheckpointResult = {
  lastProcessedCheckpoint: ProcessorCheckpoint | null;
};

const resolveTransactionId = async (
  execute: SQLExecutor,
  rawCheckpoint: string,
): Promise<ProcessorCheckpoint> => {
  if (rawCheckpoint.includes(':')) return rawCheckpoint as ProcessorCheckpoint;

  const globalPosition = BigInt(rawCheckpoint);

  if (globalPosition === 0n)
    return PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint(
      PostgreSQLEventStoreCheckpoint.default,
    );

  const row = await single(
    execute.query<ReadTransactionIdSqlResult>(
      SQL`SELECT transaction_id
           FROM ${SQL.identifier(messagesTable.name)}
           WHERE global_position = ${globalPosition}
           LIMIT 1`,
    ),
  );

  return PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint({
    transactionId: BigInt(row.transaction_id),
    globalPosition,
  });
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

  if (result === null) return { lastProcessedCheckpoint: null };

  return {
    lastProcessedCheckpoint: await resolveTransactionId(
      execute,
      result.last_processed_checkpoint,
    ),
  };
};
