import { single, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import { defaultTag, subscriptionsTable } from './typing';

export const storeSubscriptionCheckpointSQL = sql(`
CREATE OR REPLACE FUNCTION store_subscription_checkpoint(
  p_subscription_id VARCHAR(100),
  p_version BIGINT,
  p_position BIGINT,
  p_check_position BIGINT,
  p_transaction_id xid8,
  p_partition TEXT DEFAULT '${defaultTag}'
) RETURNS INT AS $$
DECLARE
  current_position BIGINT;
BEGIN
  -- Handle the case when p_check_position is provided
  IF p_check_position IS NOT NULL THEN
      -- Try to update if the position matches p_check_position
      UPDATE "${subscriptionsTable.name}"
      SET 
        "last_processed_position" = p_position, 
        "last_processed_transaction_id" = p_transaction_id
      WHERE "subscription_id" = p_subscription_id AND "last_processed_position" = p_check_position AND "partition" = p_partition;

      IF FOUND THEN
          RETURN 1;  -- Successfully updated
      END IF;

      -- Retrieve the current position
      SELECT "last_processed_position" INTO current_position
      FROM "${subscriptionsTable.name}"
      WHERE "subscription_id" = p_subscription_id AND "partition" = p_partition;

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
      INSERT INTO "${subscriptionsTable.name}"("subscription_id", "version", "last_processed_position", "partition", "last_processed_transaction_id")
      VALUES (p_subscription_id, p_version, p_position, p_partition, p_transaction_id);
      RETURN 1;  -- Successfully inserted
  EXCEPTION WHEN unique_violation THEN
      -- If insertion failed, it means the row already exists
      SELECT "last_processed_position" INTO current_position
      FROM "${subscriptionsTable.name}"
      WHERE "subscription_id" = p_subscription_id AND "partition" = p_partition;

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

export function storeProcessorCheckpoint(
  execute: SQLExecutor,
  options: {
    processorId: string;
    version: number | undefined;
    newPosition: bigint | null;
    lastProcessedPosition: bigint | null;
    partition?: string;
  },
): Promise<StoreLastProcessedProcessorPositionResult<bigint | null>>;
export function storeProcessorCheckpoint(
  execute: SQLExecutor,
  options: {
    processorId: string;
    version: number | undefined;
    newPosition: bigint;
    lastProcessedPosition: bigint | null;
    partition?: string;
  },
): Promise<StoreLastProcessedProcessorPositionResult<bigint>>;
export async function storeProcessorCheckpoint(
  execute: SQLExecutor,
  options: {
    processorId: string;
    version: number | undefined;
    newPosition: bigint | null;
    lastProcessedPosition: bigint | null;
    partition?: string;
  },
): Promise<StoreLastProcessedProcessorPositionResult<bigint | null>> {
  try {
    const { result } = await single(
      execute.command<{ result: 0 | 1 | 2 }>(
        sql(
          `SELECT store_subscription_checkpoint(%L, %s, %L, %L, pg_current_xact_id(), %L) as result;`,
          options.processorId,
          options.version ?? 1,
          options.newPosition,
          options.lastProcessedPosition,
          options.partition ?? defaultTag,
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
}
