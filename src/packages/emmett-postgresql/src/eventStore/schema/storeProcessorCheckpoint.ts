import { single, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import { v7 as uuid } from 'uuid';
import { defaultTag, processorsTable } from './typing';

export const storeSubscriptionCheckpointSQL = sql(`
CREATE OR REPLACE FUNCTION store_processor_checkpoint(
  p_processor_id           TEXT,
  p_version                BIGINT,
  p_position               TEXT,
  p_check_position         TEXT,
  p_transaction_id         xid8,
  p_partition              TEXT DEFAULT '${defaultTag}',
  p_processor_instance_id  TEXT DEFAULT gen_random_uuid()
) RETURNS INT AS $$
DECLARE
  current_position TEXT;
BEGIN
  -- Handle the case when p_check_position is provided
  IF p_check_position IS NOT NULL THEN
      -- Try to update if the position matches p_check_position
      UPDATE "${processorsTable.name}"
      SET 
        "last_processed_checkpoint" = p_position, 
        "last_processed_transaction_id" = p_transaction_id
      WHERE "processor_id" = p_processor_id AND "last_processed_checkpoint" = p_check_position AND "partition" = p_partition;

      IF FOUND THEN
          RETURN 1;  -- Successfully updated
      END IF;

      -- Retrieve the current position
      SELECT "last_processed_checkpoint" INTO current_position
      FROM "${processorsTable.name}"
      WHERE "processor_id" = p_processor_id AND "partition" = p_partition;

      -- Return appropriate codes based on current position
      IF current_position = p_position THEN
          RETURN 0;  -- Idempotent check: position already set
      ELSIF current_position > p_check_position THEN
          RETURN 2;  -- Failure: current position is greater
      ELSE
          RETURN 2;  -- Default failure case for mismatched positions
      END IF;
  END IF;

  -- Handle the case when p_check_position is NULL: Insert if not exists
  BEGIN
      INSERT INTO "${processorsTable.name}"("processor_id", "version", "last_processed_checkpoint", "partition", "last_processed_transaction_id")
      VALUES (p_processor_id, p_version, p_position, p_partition, p_transaction_id);
      RETURN 1;  -- Successfully inserted
  EXCEPTION WHEN unique_violation THEN
      -- If insertion failed, it means the row already exists
      SELECT "last_processed_checkpoint" INTO current_position
      FROM "${processorsTable.name}"
      WHERE "processor_id" = p_processor_id AND "partition" = p_partition;

      IF current_position = p_position THEN
          RETURN 0;  -- Idempotent check: position already set
      ELSE
          RETURN 2;  -- Insertion failed, row already exists with different position
      END IF;
  END;
END;
$$ LANGUAGE plpgsql;
`);

export type StoreLastProcessedProcessorPositionResult<
  Position extends bigint | null = bigint,
> =
  | {
      success: true;
      newPosition: Position;
    }
  | { success: false; reason: 'IGNORED' | 'MISMATCH' };

export const storeProcessorCheckpoint = async <Position extends bigint | null>(
  execute: SQLExecutor,
  options: {
    processorId: string;
    version: number | undefined;
    newPosition: null extends Position ? bigint | null : bigint;
    lastProcessedPosition: bigint | null;
    partition?: string;
    processorInstanceId?: string;
  },
): Promise<
  StoreLastProcessedProcessorPositionResult<
    null extends Position ? bigint | null : bigint
  >
> => {
  try {
    const { result } = await single(
      execute.command<{ result: 0 | 1 | 2 }>(
        sql(
          `SELECT store_processor_checkpoint(%L, %s, %L, %L, pg_current_xact_id(), %L, %L) as result;`,
          options.processorId,
          options.version ?? 1,
          options.newPosition?.toString().padStart(19, '0') ?? null,
          options.lastProcessedPosition?.toString().padStart(19, '0') ?? null,
          options.partition ?? defaultTag,
          options.processorInstanceId ?? uuid(),
        ),
      ),
    );

    return result === 1
      ? { success: true, newPosition: options.newPosition }
      : { success: false, reason: result === 0 ? 'IGNORED' : 'MISMATCH' };
  } catch (error) {
    console.log(error);
    throw error;
  }
};
