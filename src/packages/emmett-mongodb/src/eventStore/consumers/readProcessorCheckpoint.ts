import type { MongoClient } from 'mongodb';
import {
  DefaultProcessotCheckpointCollectionName,
  defaultTag,
  type ReadProcessorCheckpointSqlResult,
} from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReadProcessorCheckpointResult<CheckpointType = any> = {
  lastProcessedPosition: CheckpointType | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const readProcessorCheckpoint = async <CheckpointType = any>(
  client: MongoClient,
  options: {
    processorId: string;
    partition?: string;
    collectionName?: string;
    databaseName?: string;
  },
): Promise<ReadProcessorCheckpointResult<CheckpointType>> => {
  const result = await client
    .db(options.databaseName)
    .collection<ReadProcessorCheckpointSqlResult<CheckpointType>>(
      options.collectionName || DefaultProcessotCheckpointCollectionName,
    )
    .findOne({
      subscriptionId: options.processorId,
      partitionId: options.partition || defaultTag,
    });

  return {
    lastProcessedPosition: result !== null ? result.lastProcessedToken : null,
  };
};
