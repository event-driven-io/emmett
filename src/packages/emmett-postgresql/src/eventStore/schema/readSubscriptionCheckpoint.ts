import { singleOrNull, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import { defaultTag, subscriptionsTable } from './typing';

type ReadSubscriptionCheckpointSqlResult = {
  last_processed_position: string;
};

export type ReadSubscriptionCheckpointResult = {
  lastProcessedPosition: bigint | null;
};

export const readSubscriptionCheckpoint = async (
  execute: SQLExecutor,
  options: { subscriptionId: string; partition?: string },
): Promise<ReadSubscriptionCheckpointResult> => {
  const result = await singleOrNull(
    execute.query<ReadSubscriptionCheckpointSqlResult>(
      sql(
        `SELECT last_processed_position
           FROM ${subscriptionsTable.name}
           WHERE partition = %L AND subscription_id = %L
           LIMIT 1`,
        options?.partition ?? defaultTag,
        options.subscriptionId,
      ),
    ),
  );

  return {
    lastProcessedPosition:
      result !== null ? BigInt(result.last_processed_position) : null,
  };
};
