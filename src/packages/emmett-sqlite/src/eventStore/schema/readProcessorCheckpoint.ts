import type { SQLiteConnection } from '../../connection';
import { sql } from './tables';
import { defaultTag, subscriptionsTable } from './typing';
import { singleOrNull } from './utils';

type ReadProcessorCheckpointSqlResult = {
  last_processed_position: string;
};

export type ReadProcessorCheckpointResult = {
  lastProcessedPosition: bigint | null;
};

export const readProcessorCheckpoint = async (
  db: SQLiteConnection,
  options: { processorId: string; partition?: string },
): Promise<ReadProcessorCheckpointResult> => {
  const result = await singleOrNull(
    db.query<ReadProcessorCheckpointSqlResult>(
      sql(
        `SELECT last_processed_position
           FROM ${subscriptionsTable.name}
           WHERE partition = ? AND subscription_id = ?
           LIMIT 1`,
      ),
      [options?.partition ?? defaultTag, options.processorId],
    ),
  );

  return {
    lastProcessedPosition:
      result !== null ? BigInt(result.last_processed_position) : null,
  };
};
