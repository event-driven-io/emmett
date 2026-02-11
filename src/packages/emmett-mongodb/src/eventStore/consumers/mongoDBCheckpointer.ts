import {
  type Message,
  type ReadProcessorCheckpointResult,
  getCheckpoint,
} from '@event-driven-io/emmett';
import type { MongoClient } from 'mongodb';
import type { MongoDBCheckpointer } from './mongoDBProcessor';
import { compareTwoTokens } from './subscriptions';
import { DefaultProcessotCheckpointCollectionName, defaultTag } from './types';

export const mongoDBCheckpointer = <
  MessageType extends Message = Message,
>(): MongoDBCheckpointer<MessageType> => ({
  read: async (options, context) => {
    const result = await readProcessorCheckpoint(context.client, options);

    return { lastCheckpoint: result?.lastCheckpoint };
  },
  store: async (options, context) => {
    const newCheckpoint = getCheckpoint(options.message);

    const result = await storeProcessorCheckpoint(context.client, {
      lastStoredCheckpoint: options.lastCheckpoint,
      newCheckpoint,
      processorId: options.processorId,
      partition: options.partition,
      version: options.version || 0,
    });

    return result.success
      ? { success: true, newCheckpoint: result.newCheckpoint }
      : result;
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReadProcessorCheckpointMongoDBResult<Position = any> = {
  lastProcessedCheckpoint: Position;
  processorId: string;
  partitionId: string;
  version: number;
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
    .collection<ReadProcessorCheckpointMongoDBResult>(
      options.collectionName || DefaultProcessotCheckpointCollectionName,
    )
    .findOne({
      processorId: options.processorId,
      partitionId: options.partition || defaultTag,
    });

  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    lastCheckpoint: result !== null ? result.lastProcessedCheckpoint : null,
  };
};

type StoreLastProcessedProcessorPositionResult<Position = unknown> =
  | {
      success: true;
      newCheckpoint: Position;
    }
  | { success: false; reason: 'IGNORED' | 'MISMATCH' };

export const storeProcessorCheckpoint = async <Position>(
  client: MongoClient,
  {
    processorId,
    version,
    newCheckpoint,
    lastStoredCheckpoint,
    partition,
    collectionName,
    dbName,
  }: {
    processorId: string;
    version: number;
    newCheckpoint: Position | null;
    lastStoredCheckpoint: Position | null;
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
    .collection<ReadProcessorCheckpointMongoDBResult>(
      collectionName || DefaultProcessotCheckpointCollectionName,
    );

  const filter = {
    processorId: processorId,
    partitionId: partition || defaultTag,
  };

  const current = await checkpoints.findOne(filter);

  // MISMATCH: we have a checkpoint but lastProcessedCheckpoint doesn’t match
  if (
    current &&
    compareTwoTokens(current.lastProcessedCheckpoint, lastStoredCheckpoint) !==
      0
  ) {
    return { success: false, reason: 'MISMATCH' };
  }

  // IGNORED: same or earlier position
  if (current?.lastProcessedCheckpoint && newCheckpoint) {
    if (
      compareTwoTokens(current.lastProcessedCheckpoint, newCheckpoint) !== -1
    ) {
      return { success: false, reason: 'IGNORED' };
    }
  }

  const updateResult = await checkpoints.updateOne(
    { ...filter, lastProcessedCheckpoint: lastStoredCheckpoint },
    { $set: { lastProcessedCheckpoint: newCheckpoint, version } },
    { upsert: true },
  );

  if (updateResult.matchedCount > 0 || updateResult.upsertedCount > 0) {
    return { success: true, newCheckpoint: newCheckpoint! };
  }

  return { success: false, reason: 'MISMATCH' };
};
