import type { MongoClient } from 'mongodb';
import type { MongoDBResumeToken } from './subscriptions/types';
import {
  DefaultProcessotCheckpointCollectionName,
  type ReadProcessorCheckpointSqlResult,
} from './types';

export type ReadProcessorCheckpointResult = {
  lastProcessedPosition: MongoDBResumeToken | null;
};

export const readProcessorCheckpoint = async (
  client: MongoClient,
  options: {
    processorId: string;
    partition?: string;
    collectionName?: string;
    databaseName?: string;
  },
): Promise<ReadProcessorCheckpointResult> => {
  const result = await client
    .db(options.databaseName)
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
