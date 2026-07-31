import type { Dumbo } from '@event-driven-io/dumbo';
import {
  bigIntProcessorCheckpoint,
  JSONSerializer,
  parseBigIntProcessorCheckpoint,
  pollingMessageSource,
  type AnyMessage,
  type JSONSerializationOptions,
  type Message,
  type MessageSource,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import { readLastMessageGlobalPosition, readMessagesBatch } from '../../schema';

export const DefaultSQLiteEventStoreProcessorBatchSize = 100;
export const DefaultSQLiteEventStoreProcessorPullingFrequencyInMs = 50;

export type SQLiteMessageSourceOptions = {
  pool: Dumbo;
  batchSize?: number;
  pullingFrequencyInMs?: number;
} & JSONSerializationOptions;

export const sqliteMessageSource = <MessageType extends Message = AnyMessage>({
  pool,
  batchSize,
  pullingFrequencyInMs,
  serialization,
}: SQLiteMessageSourceOptions): MessageSource<
  MessageType,
  ReadEventMetadataWithGlobalPosition
> => {
  const serializer = JSONSerializer.from({ serialization });

  const readLastMessageCheckpoint = () =>
    pool.withConnection(async (connection) => {
      const { currentGlobalPosition } = await readLastMessageGlobalPosition(
        connection.execute,
      );
      return currentGlobalPosition !== null
        ? bigIntProcessorCheckpoint(currentGlobalPosition)
        : null;
    });

  return pollingMessageSource<MessageType, ReadEventMetadataWithGlobalPosition>(
    {
      readBatch: async ({ after, batchSize: requestedBatchSize }) => {
        const { messages, currentGlobalPosition, areMessagesLeft } =
          await readMessagesBatch<MessageType>(pool.execute, {
            after: after !== null ? parseBigIntProcessorCheckpoint(after) : 0n,
            batchSize: requestedBatchSize,
            serializer,
          });

        return {
          messages,
          currentCheckpoint: bigIntProcessorCheckpoint(currentGlobalPosition),
          areMessagesLeft,
        };
      },
      readLastMessageCheckpoint,
      batchSize: batchSize ?? DefaultSQLiteEventStoreProcessorBatchSize,
      pullingFrequencyInMs:
        pullingFrequencyInMs ??
        DefaultSQLiteEventStoreProcessorPullingFrequencyInMs,
    },
  );
};
