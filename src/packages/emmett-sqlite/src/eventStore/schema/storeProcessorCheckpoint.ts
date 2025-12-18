import { isSQLiteError, type SQLiteConnection } from '../../connection';
import { sql } from './tables';
import { defaultTag, processorsTable } from './typing';
import { singleOrNull } from './utils';

// for more infos see the postgresql stored procedure version
async function storeSubscriptionCheckpointSQLite(
  db: SQLiteConnection,
  processorId: string,
  version: number,
  position: bigint | null,
  checkPosition: bigint | null,
  partition: string,
): Promise<0 | 1 | 2> {
  if (checkPosition !== null) {
    const updateResult = await db.command(
      sql(`
          UPDATE ${processorsTable.name}
          SET last_processed_checkpoint = ?
          WHERE processor_id = ? 
            AND last_processed_checkpoint = ? 
            AND partition = ?
        `),
      [position!.toString(), processorId, checkPosition.toString(), partition],
    );
    if (updateResult.changes > 0) {
      return 1;
    } else {
      const current_position = await singleOrNull(
        db.query<{ last_processed_checkpoint: bigint }>(
          sql(
            `SELECT last_processed_checkpoint FROM ${processorsTable.name} 
               WHERE processor_id = ? AND partition = ?`,
          ),
          [processorId, partition],
        ),
      );

      if (current_position?.last_processed_checkpoint === position) {
        return 0;
      } else if (
        position !== null &&
        current_position !== null &&
        current_position?.last_processed_checkpoint > position
      ) {
        return 2;
      } else {
        return 2;
      }
    }
  } else {
    try {
      await db.command(
        sql(
          `INSERT INTO ${processorsTable.name} (processor_id, version, last_processed_checkpoint, partition) VALUES (?, ?, ?, ?)`,
        ),
        [processorId, version, position!.toString(), partition],
      );
      return 1;
    } catch (err) {
      if (!(isSQLiteError(err) && (err.errno === 19 || err.errno === 2067))) {
        throw err;
      }

      const current = await singleOrNull(
        db.query<{ last_processed_checkpoint: bigint }>(
          sql(
            `SELECT last_processed_checkpoint FROM ${processorsTable.name} WHERE processor_id = ? AND partition = ?`,
          ),
          [processorId, partition],
        ),
      );
      if (current?.last_processed_checkpoint === position) {
        return 0;
      } else {
        return 2;
      }
    }
  }
}

export type StoreLastProcessedProcessorPositionResult<
  Position extends bigint | null = bigint,
> =
  | {
      success: true;
      newPosition: Position;
    }
  | { success: false; reason: 'IGNORED' | 'MISMATCH' };

export async function storeProcessorCheckpoint(
  db: SQLiteConnection,
  options: {
    processorId: string;
    version: number | undefined;
    newPosition: bigint | null;
    lastProcessedPosition: bigint | null;
    partition?: string;
  },
): Promise<StoreLastProcessedProcessorPositionResult<bigint | null>> {
  try {
    const result = await storeSubscriptionCheckpointSQLite(
      db,
      options.processorId,
      options.version ?? 1,
      options.newPosition,
      options.lastProcessedPosition,
      options.partition ?? defaultTag,
    );

    return result === 1
      ? { success: true, newPosition: options.newPosition }
      : { success: false, reason: result === 0 ? 'IGNORED' : 'MISMATCH' };
  } catch (error) {
    console.log(error);
    throw error;
  }
}
