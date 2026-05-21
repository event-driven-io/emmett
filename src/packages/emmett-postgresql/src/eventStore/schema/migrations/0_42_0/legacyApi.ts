import {
  single,
  SQL,
  singleOrNull,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import type { ProcessorCheckpoint } from '@event-driven-io/emmett';
import { defaultTag, processorsTable, unknownTag } from '../../typing';

export {
  appendToStream,
  insertSubscriptionCheckpoint,
  readEvents,
  readSubscriptionCheckpoint,
  storeSubscriptionCheckpoint,
} from '../0_38_7/legacyApi';

export type StoreProcessorCheckpointResult =
  | { success: true; newCheckpoint: ProcessorCheckpoint | null }
  | { success: false; reason: 'IGNORED' | 'MISMATCH' | 'CURRENT_AHEAD' };

export const storeProcessorCheckpoint = async (
  execute: SQLExecutor,
  options: {
    processorId: string;
    version?: number;
    newCheckpoint: ProcessorCheckpoint | null;
    lastProcessedCheckpoint: ProcessorCheckpoint | null;
    partition?: string;
    processorInstanceId?: string;
  },
): Promise<StoreProcessorCheckpointResult> => {
  const { result } = await single(
    execute.command<{ result: 0 | 1 | 2 | 3 }>(
      SQL`SELECT store_processor_checkpoint(
        ${options.processorId},
        ${options.version ?? 1},
        ${options.newCheckpoint},
        ${options.lastProcessedCheckpoint},
        pg_current_xact_id(),
        ${options.partition ?? defaultTag},
        ${options.processorInstanceId ?? unknownTag}
      ) as result`,
    ),
  );

  return result === 1
    ? { success: true, newCheckpoint: options.newCheckpoint }
    : {
        success: false,
        reason:
          result === 0
            ? 'IGNORED'
            : result === 3
              ? 'CURRENT_AHEAD'
              : 'MISMATCH',
      };
};

export const readProcessorCheckpoint = async (
  execute: SQLExecutor,
  options: { processorId: string; partition?: string; version?: number },
): Promise<{ lastProcessedCheckpoint: ProcessorCheckpoint | null }> => {
  const row = await singleOrNull(
    execute.query<{ last_processed_checkpoint: string }>(
      SQL`SELECT last_processed_checkpoint
           FROM ${SQL.identifier(processorsTable.name)}
           WHERE partition = ${options.partition ?? defaultTag}
             AND processor_id = ${options.processorId}
             AND version = ${options.version ?? 1}
           LIMIT 1`,
    ),
  );

  if (row === null) return { lastProcessedCheckpoint: null };

  return {
    lastProcessedCheckpoint:
      row.last_processed_checkpoint as ProcessorCheckpoint,
  };
};
