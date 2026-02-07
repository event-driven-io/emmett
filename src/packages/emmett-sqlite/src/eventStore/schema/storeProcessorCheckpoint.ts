import {
  DumboError,
  singleOrNull,
  SQL,
  UniqueConstraintError,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import { defaultTag, processorsTable, unknownTag } from './typing';

const { identifier } = SQL;

// for more infos see the postgresql stored procedure version
async function storeSubscriptionCheckpointSQLite(
  execute: SQLExecutor,
  processorId: string,
  version: number,
  position: bigint | null,
  checkPosition: bigint | null,
  partition: string,
  processorInstanceId?: string,
): Promise<0 | 1 | 2> {
  processorInstanceId ??= unknownTag;
  if (checkPosition !== null) {
    const updateResult = await execute.command(
      SQL`
          UPDATE ${identifier(processorsTable.name)}
          SET 
            last_processed_checkpoint = ${position},
            processor_instance_id = ${processorInstanceId}
          WHERE processor_id = ${processorId} 
            AND last_processed_checkpoint = ${checkPosition} 
            AND partition = ${partition}
        `,
    );
    if (updateResult.rowCount && updateResult.rowCount > 0) {
      return 1;
    }
    const current_position = await singleOrNull(
      execute.query<{ last_processed_checkpoint: string }>(
        SQL`
          SELECT last_processed_checkpoint FROM ${identifier(processorsTable.name)} 
               WHERE processor_id = ${processorId} AND partition = ${partition}`,
      ),
    );

    const currentPosition =
      current_position && current_position?.last_processed_checkpoint !== null
        ? BigInt(current_position.last_processed_checkpoint)
        : null;

    if (currentPosition === position) {
      return 0;
    } else if (
      position !== null &&
      currentPosition !== null &&
      currentPosition > position
    ) {
      return 2;
    } else {
      return 2;
    }
  } else {
    try {
      await execute.command(
        SQL`INSERT INTO ${identifier(processorsTable.name)} (processor_id, version, last_processed_checkpoint, partition, processor_instance_id) 
        VALUES (${processorId}, ${version}, ${position}, ${partition}, ${processorInstanceId})`,
      );
      return 1;
    } catch (err) {
      if (
        !DumboError.isInstanceOf(err, {
          errorType: UniqueConstraintError.ErrorType,
        })
      ) {
        throw err;
      }

      const current = await singleOrNull(
        execute.query<{ last_processed_checkpoint: string }>(
          SQL`
            SELECT last_processed_checkpoint FROM ${identifier(processorsTable.name)} 
            WHERE processor_id = ${processorId} AND partition = ${partition}`,
        ),
      );
      const currentPosition =
        current && current?.last_processed_checkpoint !== null
          ? BigInt(current.last_processed_checkpoint)
          : null;

      if (currentPosition === position) {
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
    const result = await storeSubscriptionCheckpointSQLite(
      execute,
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
