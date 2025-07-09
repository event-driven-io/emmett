import { toStreamCollectionName } from '../mongoDBEventStore';
import type { MongoDBResumeToken } from './subscriptions/types';

export const DefaultProcessotCheckpointCollectionName =
  toStreamCollectionName(`processors`);

export type ReadProcessorCheckpointSqlResult = {
  lastProcessedToken: MongoDBResumeToken | null;
  subscriptionId: string;
  partitionId: string | null;
  version: number;
};
