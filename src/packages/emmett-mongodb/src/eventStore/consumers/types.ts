import { toStreamCollectionName } from '../mongoDBEventStore';

export const defaultTag = 'emt:default';

export const DefaultProcessotCheckpointCollectionName =
  toStreamCollectionName(`processors`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReadProcessorCheckpointSqlResult<Position = any> = {
  lastProcessedToken: Position;
  subscriptionId: string;
  partitionId: string;
  version: number;
};
