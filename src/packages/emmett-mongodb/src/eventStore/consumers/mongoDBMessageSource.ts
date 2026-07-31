import {
  delayOrAbort,
  MessageSourceCaughtUp,
  ProcessorCheckpoint,
  subscriptionMessageSource,
  type AnyMessage,
  type AsyncRetryOptions,
  type Message,
  type MessageSource,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import type { MongoClient } from 'mongodb';
import type { MongoDBChangeStreamMessageMetadata } from './mongoDBEventStoreConsumer';
import {
  getDatabaseVersionPolicies,
  MongoDBResubscribeDefaultOptions,
  oplogChangeToMessages,
  readLastCommittedMessageCheckpoint,
  subscribe,
  toMongoDBCheckpoint,
  type MongoDBCheckpoint,
} from './subscriptions';

export const DefaultMongoDBEventStoreProcessorBatchSize = 100;
export const DefaultMongoDBEventStoreProcessorPullingFrequencyInMs = 50;

export type MongoDBMessageSourceOptions = {
  client: MongoClient;
  dbName?: string;
  batchSize?: number;
  pullingFrequencyInMs?: number;
  resilience?: {
    resubscribeOptions?: AsyncRetryOptions;
  };
};

export const mongoDBMessageSource = <MessageType extends Message = AnyMessage>({
  client,
  dbName,
  batchSize,
  pullingFrequencyInMs,
  resilience,
}: MongoDBMessageSourceOptions): MessageSource<
  MessageType,
  MongoDBChangeStreamMessageMetadata
> => {
  const db = () => client.db(dbName);

  const idleWaitInMs =
    pullingFrequencyInMs ??
    DefaultMongoDBEventStoreProcessorPullingFrequencyInMs;

  const resubscribeOptions = resilience?.resubscribeOptions ?? {
    ...MongoDBResubscribeDefaultOptions,
    shouldRetryResult: () => true,
  };

  return subscriptionMessageSource<
    MessageType,
    MongoDBChangeStreamMessageMetadata
  >({
    subscribe: async function* ({ from, signal }) {
      const { changeStreamFullDocumentValuePolicy } =
        await getDatabaseVersionPolicies(db());

      const changeStream = subscribe(
        changeStreamFullDocumentValuePolicy,
        db(),
      )<MessageType>(from);

      // A change stream has no non-blocking read, so an abort has to reach it
      // by closing it. `tryNext` then rejects, which the source treats as a
      // torn-down subscription rather than a failure worth resubscribing to.
      const onAbort = () => void changeStream.close();
      signal.addEventListener('abort', onAbort, { once: true });

      let lastCheckpoint: MongoDBCheckpoint | null = null;

      try {
        while (!signal.aborted) {
          const change = await changeStream.tryNext();

          if (!change) {
            yield MessageSourceCaughtUp(
              lastCheckpoint ?? ProcessorCheckpoint('0'),
            );

            await delayOrAbort(idleWaitInMs, signal);
            continue;
          }

          for (const [index, message] of oplogChangeToMessages(
            change,
          ).entries()) {
            lastCheckpoint = toMongoDBCheckpoint(change._id, index);

            yield {
              kind: message.kind,
              type: message.type,
              data: message.data,
              metadata: {
                ...message.metadata,
                checkpoint: lastCheckpoint,
                globalPosition: lastCheckpoint,
              },
            } as unknown as RecordedMessage<
              MessageType,
              MongoDBChangeStreamMessageMetadata
            >;
          }
        }
      } finally {
        signal.removeEventListener('abort', onAbort);
        await changeStream.close();
      }
    },
    readLastMessageCheckpoint: async (): Promise<ProcessorCheckpoint | null> =>
      (await readLastCommittedMessageCheckpoint(db())) ?? null,
    batchSize: batchSize ?? DefaultMongoDBEventStoreProcessorBatchSize,
    resilience: resubscribeOptions,
  });
};
