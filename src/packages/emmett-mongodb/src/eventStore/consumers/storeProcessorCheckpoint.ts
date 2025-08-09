import type { MongoClient } from 'mongodb';
import { compareTwoTokens } from './subscriptions';
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
    version: number;
    newPosition: null extends Position
      ? MongoDBResumeToken | null
      : MongoDBResumeToken;
    lastProcessedPosition: MongoDBResumeToken | null;
    partition?: string;
    collectionName?: string;
    dbName?: string;
  },
): Promise<
  StoreLastProcessedProcessorPositionResult<
    null extends Position ? MongoDBResumeToken | null : MongoDBResumeToken
  >
> => {
  try {
    const checkpoints = client
      .db(options.dbName)
      .collection<ReadProcessorCheckpointSqlResult>(
        options.collectionName || DefaultProcessotCheckpointCollectionName,
      );
    const currentCheckpoint = await checkpoints.findOne({
      subscriptionId: options.processorId,
      partitionId: options.partition || null,
    });
    const matchedCheckpoint = await checkpoints.findOne({
      subscriptionId: options.processorId,
      partitionId: options.partition || null,
      lastProcessedToken: options.lastProcessedPosition,
    });

    if (currentCheckpoint && !matchedCheckpoint) {
      return {
        success: false,
        reason: 'MISMATCH',
      };
    }

    if (matchedCheckpoint?.lastProcessedToken && options?.newPosition) {
      const comparison = compareTwoTokens(
        matchedCheckpoint.lastProcessedToken,
        options.newPosition,
      );

      // if the tokens are the same or
      // the `currentCheckpoint.lastProcessedToken` is later than the `options.newPosition`.
      if (comparison !== -1) {
        return {
          success: false,
          reason: 'IGNORED',
        };
      }
    }

    const result = currentCheckpoint
      ? await checkpoints.findOneAndUpdate(
          {
            subscriptionId: options.processorId,
            partitionId: options.partition || null,
            lastProcessedToken: options.lastProcessedPosition,
          },
          {
            $set: {
              lastProcessedToken: options.newPosition,
              version: options.version,
            },
          },
          {
            returnDocument: 'after',
          },
        )
      : await checkpoints.insertOne({
          subscriptionId: options.processorId,
          partitionId: options.partition || null,
          lastProcessedToken: options.newPosition,
          version: options.version,
        });

    return (result &&
      'acknowledged' in result &&
      result.acknowledged &&
      result.insertedId) ||
      (result &&
        'lastProcessedToken' in result &&
        result.lastProcessedToken?._data === options.newPosition?._data)
      ? { success: true, newPosition: options.newPosition }
      : {
          success: false,
          reason: 'MISMATCH',
        };
  } catch (error) {
    console.log(error);
    throw error;
  }
};
