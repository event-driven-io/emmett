import type { MongoClient } from 'mongodb';
import { compareTwoTokens } from './subscriptions';
import {
  type ReadProcessorCheckpointSqlResult,
  DefaultProcessotCheckpointCollectionName,
} from './types';

export type StoreLastProcessedProcessorPositionResult<Position = unknown> =
  | {
      success: true;
      newPosition: Position;
    }
  | { success: false; reason: 'IGNORED' | 'MISMATCH' };

export const storeProcessorCheckpoint = async <Position>(
  client: MongoClient,
  {
    processorId,
    version,
    newPosition,
    lastProcessedPosition,
    partition,
    collectionName,
    dbName,
  }: {
    processorId: string;
    version: number;
    newPosition: Position | null;
    lastProcessedPosition: Position | null;
    partition?: string;
    collectionName?: string;
    dbName?: string;
  },
): Promise<
  StoreLastProcessedProcessorPositionResult<
    null extends Position ? Position | null : Position
  >
> => {
  const checkpoints = client
    .db(dbName)
    .collection<ReadProcessorCheckpointSqlResult>(
      collectionName || DefaultProcessotCheckpointCollectionName,
    );

  const filter = {
    subscriptionId: processorId,
    partitionId: partition || null,
  };

  const current = await checkpoints.findOne(filter);

  // MISMATCH: we have a checkpoint but lastProcessedPosition doesn’t match
  if (
    current &&
    compareTwoTokens(current.lastProcessedToken, lastProcessedPosition) !== 0
  ) {
    return { success: false, reason: 'MISMATCH' };
  }

  // IGNORED: same or earlier position
  if (current?.lastProcessedToken && newPosition) {
    if (compareTwoTokens(current.lastProcessedToken, newPosition) !== -1) {
      return { success: false, reason: 'IGNORED' };
    }
  }

  const updateResult = await checkpoints.updateOne(
    { ...filter, lastProcessedToken: lastProcessedPosition },
    { $set: { lastProcessedToken: newPosition, version } },
    { upsert: true },
  );

  if (updateResult.matchedCount > 0 || updateResult.upsertedCount > 0) {
    return { success: true, newPosition: newPosition! };
  }

  return { success: false, reason: 'MISMATCH' };
};
