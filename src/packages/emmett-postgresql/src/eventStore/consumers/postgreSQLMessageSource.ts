import type { Dumbo } from '@event-driven-io/dumbo';
import {
  pollingMessageSource,
  type AnyMessage,
  type Message,
  type MessageSource,
  type ProcessorCheckpoint,
  type RecordedMessageMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import {
  PostgreSQLEventStoreCheckpoint,
  readLastCommittedMessageCheckpoint,
  readMessagesBatch,
} from '../schema';

export const DefaultPostgreSQLEventStoreProcessorBatchSize = 100;
export const DefaultPostgreSQLEventStoreProcessorPullingFrequencyInMs = 50;

export type PostgreSQLMessageSourceOptions = {
  pool: Dumbo;
  batchSize?: number;
  pullingFrequencyInMs?: number;
  partition?: string;
};

export const postgreSQLMessageSource = <
  MessageType extends Message = AnyMessage,
>({
  pool,
  batchSize,
  pullingFrequencyInMs,
  partition,
}: PostgreSQLMessageSourceOptions): MessageSource<
  MessageType,
  RecordedMessageMetadataWithGlobalPosition
> => {
  const toCheckpoint = (
    checkpoint: PostgreSQLEventStoreCheckpoint | null,
  ): ProcessorCheckpoint | null =>
    checkpoint !== null
      ? PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint(checkpoint)
      : null;

  return pollingMessageSource<
    MessageType,
    RecordedMessageMetadataWithGlobalPosition
  >({
    readBatch: async ({ after, batchSize: requestedBatchSize }) => {
      const { messages, currentCheckpoint, areMessagesLeft } =
        await readMessagesBatch<MessageType>(pool.execute, {
          after: PostgreSQLEventStoreCheckpoint.parse(after),
          batchSize: requestedBatchSize,
        });

      return {
        messages,
        currentCheckpoint: toCheckpoint(currentCheckpoint),
        areMessagesLeft,
      };
    },
    readLastMessageCheckpoint: () =>
      pool.withConnection(async (connection) => {
        const { currentCheckpoint } = await readLastCommittedMessageCheckpoint(
          connection.execute,
          { partition },
        );
        return toCheckpoint(currentCheckpoint);
      }),
    readLastCommittedCheckpoint: () =>
      pool.withConnection(async (connection) => {
        const { currentCheckpoint } = await readLastCommittedMessageCheckpoint(
          connection.execute,
          { partition },
        );
        return toCheckpoint(currentCheckpoint);
      }),
    batchSize: batchSize ?? DefaultPostgreSQLEventStoreProcessorBatchSize,
    pullingFrequencyInMs:
      pullingFrequencyInMs ??
      DefaultPostgreSQLEventStoreProcessorPullingFrequencyInMs,
  });
};
