import type { MongoClient } from 'mongodb';
import type { MongoDBResumeToken } from './subscriptions/types';
import {
  DefaultProcessotCheckpointCollectionName,
  type ReadProcessorCheckpointSqlResult,
} from './types';

export type StoreLastProcessedProcessorPositionResult<
  Position extends MongoDBResumeToken | null = MongoDBResumeToken,
> =
  | {
      success: true;
      newPosition: Position;
    }
  | { success: false; reason: 'IGNORED' | 'MISMATCH' };

export const storeProcessorCheckpoint = async <Position extends string | null>(
  client: MongoClient,
  options: {
    processorId: string;
    version: number | undefined;
    newPosition: null extends Position
      ? MongoDBResumeToken | null
      : MongoDBResumeToken;
    lastProcessedPosition: MongoDBResumeToken | null;
    partition?: string;
    collectionName?: string;
  },
): Promise<
  StoreLastProcessedProcessorPositionResult<
    null extends Position ? MongoDBResumeToken | null : MongoDBResumeToken
  >
> => {
  try {
    const result = await client
      .db()
      .collection<ReadProcessorCheckpointSqlResult>(
        options.collectionName || DefaultProcessotCheckpointCollectionName,
      )
      .updateOne(
        {
          subscriptionId: options.processorId,
          partitionId: options.partition || null,
          lastProcessedToken: options.lastProcessedPosition,
        },
        {
          $set: {
            subscriptionId: options.processorId,
            partitionId: options.partition || null,
            lastProcessedToken: options.newPosition,
            version: options.version,
          },
        },
        {
          upsert: true,
        },
      );

    return result.modifiedCount || result.upsertedCount
      ? { success: true, newPosition: options.newPosition }
      : {
          success: false,
          reason: result.matchedCount === 0 ? 'IGNORED' : 'MISMATCH',
        };
  } catch (error) {
    console.log(error);
    throw error;
  }
};
