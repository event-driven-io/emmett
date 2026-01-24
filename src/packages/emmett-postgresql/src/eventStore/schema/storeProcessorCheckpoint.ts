import { single, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import { bigInt } from '@event-driven-io/emmett';
import { createFunctionIfDoesNotExistSQL } from './createFunctionIfDoesNotExist';
import { defaultTag, processorsTable, unknownTag } from './typing';

export const storeSubscriptionCheckpointSQL = createFunctionIfDoesNotExistSQL(
  'store_processor_checkpoint',
  `
CREATE OR REPLACE FUNCTION store_processor_checkpoint(
  p_processor_id           TEXT,
  p_version                BIGINT,
  p_position               TEXT,
  p_check_position         TEXT,
  p_transaction_id         xid8,
  p_partition              TEXT DEFAULT '${defaultTag}',
  p_processor_instance_id  TEXT DEFAULT '${unknownTag}'
) RETURNS INT AS $spc$
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
$spc$ LANGUAGE plpgsql;
`,
);

export type StoreLastProcessedProcessorPositionResult<
  Position extends bigint | null = bigint,
> =
  | {
      success: true;
      newCheckpoint: Position;
    }
  | { success: false; reason: 'IGNORED' | 'MISMATCH' };

export const storeProcessorCheckpoint = async <Position extends bigint | null>(
  execute: SQLExecutor,
  options: {
    processorId: string;
    version: number | undefined;
    newCheckpoint: null extends Position ? bigint | null : bigint;
    lastProcessedCheckpoint: bigint | null;
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
          options.newCheckpoint !== null
            ? bigInt.toNormalizedString(options.newCheckpoint)
            : null,
          options.lastProcessedCheckpoint !== null
            ? bigInt.toNormalizedString(options.lastProcessedCheckpoint)
            : null,
          options.partition ?? defaultTag,
          options.processorInstanceId ?? unknownTag,
        ),
      ),
    );

    return result === 1
      ? { success: true, newCheckpoint: options.newCheckpoint }
      : { success: false, reason: result === 0 ? 'IGNORED' : 'MISMATCH' };
  } catch (error) {
    console.log(error);
    throw error;
  }
};
