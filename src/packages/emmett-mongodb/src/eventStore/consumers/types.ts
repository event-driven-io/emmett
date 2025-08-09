import { toStreamCollectionName } from '../mongoDBEventStore';

export const DefaultProcessotCheckpointCollectionName =
  toStreamCollectionName(`processors`);

export type ReadProcessorCheckpointSqlResult<Position = unknown> = {
  lastProcessedToken: Position;
  subscriptionId: string;
  partitionId: string | null;
  version: number;
};
