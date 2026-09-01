import { SQL, type SQLExecutor, singleOrNull } from '@event-driven-io/dumbo';
import { defaultTag, messagesTable, tableReference } from './typing';

type ReadLastMessageGlobalPositionSqlResult = {
  global_position: string;
};

export type ReadLastMessageGlobalPositionResult = {
  currentGlobalPosition: bigint | null;
};

export const readLastMessageGlobalPosition = async (
  execute: SQLExecutor,
  options?: { partition?: string; databaseSchemaName?: string },
): Promise<ReadLastMessageGlobalPositionResult> => {
  const result = await singleOrNull(
    execute.query<ReadLastMessageGlobalPositionSqlResult>(
      SQL`
         SELECT global_position
         FROM ${tableReference(options?.databaseSchemaName, messagesTable.name)}
         WHERE partition = ${options?.partition ?? defaultTag} AND is_archived = FALSE
         ORDER BY global_position DESC
         LIMIT 1`,
    ),
  );

  return {
    currentGlobalPosition:
      result !== null ? BigInt(result.global_position) : null,
  };
};
