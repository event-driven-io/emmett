import type { SQLiteConnection } from '../../connection';
import { sql } from './tables';
import { defaultTag, messagesTable } from './typing';
import { singleOrNull } from './utils';

type ReadLastMessageGlobalPositionSqlResult = {
  global_position: string;
};

export type ReadLastMessageGlobalPositionResult = {
  currentGlobalPosition: bigint | null;
};

export const readLastMessageGlobalPosition = async (
  db: SQLiteConnection,
  options?: { partition?: string },
): Promise<ReadLastMessageGlobalPositionResult> => {
  const result = await singleOrNull(
    db.query<ReadLastMessageGlobalPositionSqlResult>(
      sql(
        `SELECT global_position
         FROM ${messagesTable.name}
         WHERE partition = ? AND is_archived = FALSE
         ORDER BY global_position
         LIMIT 1`,
      ),
      [options?.partition ?? defaultTag],
    ),
  );

  return {
    currentGlobalPosition:
      result !== null ? BigInt(result.global_position) : null,
  };
};
