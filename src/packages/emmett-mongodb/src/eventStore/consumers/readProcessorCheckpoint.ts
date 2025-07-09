import type { MongoClient } from 'mongodb';
import {
  DefaultProcessotCheckpointCollectionName,
  type ReadProcessorCheckpointSqlResult,
} from './types';
import type { MongoDBResumeToken } from './subscriptions/types';

export type ReadProcessorCheckpointResult = {
  lastProcessedPosition: MongoDBResumeToken | null;
};

export const readProcessorCheckpoint = async (
  client: MongoClient,
  options: { processorId: string; partition?: string; collectionName?: string },
): Promise<ReadProcessorCheckpointResult> => {
  const result = await client
    .db()
    .collection<ReadProcessorCheckpointSqlResult>(
      options.collectionName || DefaultProcessotCheckpointCollectionName,
    )
    .findOne({
      subscriptionId: options.processorId,
      partitionId: options.partition || null,
    });

  return {
    lastProcessedPosition: result !== null ? result.lastProcessedToken : null,
  };
};
