import { single, SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import type { ProcessorCheckpoint } from '@event-driven-io/emmett';
import { createFunctionIfDoesNotExistSQL } from './createFunctionIfDoesNotExist';
import { defaultTag, processorsTable, unknownTag } from './typing';

export const storeSubscriptionCheckpointSQL = createFunctionIfDoesNotExistSQL(
  'store_processor_checkpoint',
  SQL`
CREATE OR REPLACE FUNCTION store_processor_checkpoint(
  p_processor_id           TEXT,
  p_version                BIGINT,
  p_position               TEXT,
  p_check_position         TEXT,
  p_transaction_id         xid8,
  p_partition              TEXT DEFAULT '${SQL.plain(defaultTag)}',
  p_processor_instance_id  TEXT DEFAULT '${SQL.plain(unknownTag)}'
) RETURNS INT AS $spc$
DECLARE
  current_position TEXT;
BEGIN
  -- Handle the case when p_check_position is provided
  IF p_check_position IS NOT NULL THEN
      -- Try to update if the position matches p_check_position
      UPDATE "${SQL.plain(processorsTable.name)}"
      SET
        "last_processed_checkpoint" = p_position,
        "last_processed_transaction_id" = p_transaction_id,
        "last_updated" = now()
      WHERE "processor_id" = p_processor_id
        AND "last_processed_checkpoint" = p_check_position
        AND "partition" = p_partition
        AND "version" = p_version;

      IF FOUND THEN
          RETURN 1;  -- Successfully updated
      END IF;

      -- Retrieve the current position
      SELECT "last_processed_checkpoint" INTO current_position
      FROM "${SQL.plain(processorsTable.name)}"
      WHERE "processor_id" = p_processor_id 
        AND "partition" = p_partition 
        AND "version" = p_version;

      -- Return appropriate codes based on current position
      IF current_position = p_position THEN
          RETURN 0;  -- Idempotent check: position already set
      ELSIF current_position > p_position THEN
          RETURN 3;  -- Current ahead: another process has progressed further
      ELSE
          RETURN 2;  -- Mismatch: check position doesn't match current
      END IF;
  END IF;

  -- Handle the case when p_check_position is NULL: Insert if not exists
  BEGIN
      INSERT INTO "${SQL.plain(processorsTable.name)}"("processor_id", "version", "last_processed_checkpoint", "partition", "last_processed_transaction_id", "created_at", "last_updated")
      VALUES (p_processor_id, p_version, p_position, p_partition, p_transaction_id, now(), now());
      RETURN 1;  -- Successfully inserted
  EXCEPTION WHEN unique_violation THEN
      -- If insertion failed, it means the row already exists
      SELECT "last_processed_checkpoint" INTO current_position
      FROM "${SQL.plain(processorsTable.name)}"
      WHERE "processor_id" = p_processor_id 
        AND "partition" = p_partition 
        AND "version" = p_version;

      IF current_position = p_position THEN
          RETURN 0;  -- Idempotent check: position already set
      ELSIF current_position > p_position THEN
          RETURN 3;  -- Current ahead: another process has progressed further
      ELSE
          RETURN 2;  -- Insertion failed, row already exists with different position
      END IF;
  END;
END;
$spc$ LANGUAGE plpgsql;
`,
);

type CallStoreProcessorCheckpointParams = {
  processorId: string;
  version: number;
  position: string | null;
  checkPosition: string | null;
  partition: string;
  processorInstanceId: string;
};

export const callStoreProcessorCheckpoint = (
  params: CallStoreProcessorCheckpointParams,
) =>
  SQL`
    SELECT store_processor_checkpoint(
      ${params.processorId}, 
      ${params.version}, 
      ${params.position}, 
      ${params.checkPosition}, 
      pg_current_xact_id(), 
      ${params.partition}, 
      ${params.processorInstanceId}
    ) as result;`;

export type StoreLastProcessedProcessorPositionResult =
  | {
      success: true;
      newCheckpoint: ProcessorCheckpoint | null;
    }
  | { success: false; reason: 'IGNORED' | 'MISMATCH' | 'CURRENT_AHEAD' };

export const storeProcessorCheckpoint = async (
  execute: SQLExecutor,
  options: {
    processorId: string;
    version: number | undefined;
    newCheckpoint: ProcessorCheckpoint | null;
    lastProcessedCheckpoint: ProcessorCheckpoint | null;
    partition?: string;
    processorInstanceId?: string;
  },
): Promise<StoreLastProcessedProcessorPositionResult> => {
  try {
    const { result } = await single(
      execute.command<{ result: 0 | 1 | 2 | 3 }>(
        callStoreProcessorCheckpoint({
          processorId: options.processorId,
          version: options.version ?? 1,
          position:
            options.newCheckpoint !== null ? options.newCheckpoint : null,
          checkPosition:
            options.lastProcessedCheckpoint !== null
              ? options.lastProcessedCheckpoint
              : null,
          partition: options.partition ?? defaultTag,
          processorInstanceId: options.processorInstanceId ?? unknownTag,
        }),
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
  } catch (error) {
    console.log(error);
    throw error;
  }
};
