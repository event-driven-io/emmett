import type { ReadProcessorCheckpointResult } from '@event-driven-io/emmett';
import type { MongoClient } from 'mongodb';
import { DefaultProcessotCheckpointCollectionName, defaultTag } from './types';

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
    .collection<ReadProcessorCheckpointResult<CheckpointType>>(
      options.collectionName || DefaultProcessotCheckpointCollectionName,
    )
    .findOne({
      subscriptionId: options.processorId,
      partitionId: options.partition || defaultTag,
    });

  return {
    lastCheckpoint: result !== null ? result.lastCheckpoint : null,
  };
};
