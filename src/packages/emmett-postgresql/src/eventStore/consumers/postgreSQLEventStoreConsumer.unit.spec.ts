import {
  assertDeepEqual,
  assertEqual,
  inMemoryMessageSource,
  ProcessorCheckpoint,
  reactor,
  type Event,
  type MessageSource,
  type RecordedMessage,
  type RecordedMessageMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { describe, it } from 'vitest';
import { getPostgreSQLEventStore } from '../postgreSQLEventStore';
import {
  postgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumer,
} from './postgreSQLEventStoreConsumer';

type Tested = Event<'Tested', { index: number }>;

type TestedMessageSource = MessageSource<
  Tested,
  RecordedMessageMetadataWithGlobalPosition
>;

const connectionString =
  'postgresql://postgres:postgres@not-existing-database:5432/postgres';

const messageAt = (
  index: number,
): RecordedMessage<Tested, RecordedMessageMetadataWithGlobalPosition> =>
  ({
    type: 'Tested',
    data: { index },
    kind: 'Event',
    metadata: {
      checkpoint: ProcessorCheckpoint(`${index}`),
      globalPosition: BigInt(index),
    },
  }) as unknown as RecordedMessage<
    Tested,
    RecordedMessageMetadataWithGlobalPosition
  >;

const collectingReactor = (handled: number[]) =>
  reactor<Tested>({
    processorId: uuid(),
    checkpoints: 'DISABLED',
    eachMessage: (message) => {
      handled.push(message.data.index);
    },
  });

void describe('PostgreSQL event store consumer', () => {
  void describe('with injected message source', () => {
    void it('handles messages read from the injected source', async () => {
      const source = inMemoryMessageSource<
        Tested,
        RecordedMessageMetadataWithGlobalPosition
      >({
        messages: [messageAt(1), messageAt(2)],
      });
      const handled: number[] = [];

      const consumer = postgreSQLEventStoreConsumer<Tested>({
        connectionString,
        source,
        processors: [collectingReactor(handled)],
        stopWhen: { noMessagesLeft: true },
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      assertDeepEqual(handled, [1, 2]);
    });

    void it('does not close the injected source', async () => {
      const source = inMemoryMessageSource<
        Tested,
        RecordedMessageMetadataWithGlobalPosition
      >({
        messages: [messageAt(1)],
      });
      let closeCount = 0;
      const trackedSource: TestedMessageSource = {
        ...source,
        close: () => {
          closeCount++;
          return Promise.resolve();
        },
      };

      const consumer = postgreSQLEventStoreConsumer<Tested>({
        connectionString,
        source: trackedSource,
        processors: [collectingReactor([])],
        stopWhen: { noMessagesLeft: true },
      });

      await consumer.start();
      await consumer.close();

      assertEqual(closeCount, 0);
      assertEqual(
        await source.readLastMessageCheckpoint(),
        ProcessorCheckpoint('1'),
      );
    });

    void it('registers an existing processor through reactor', async () => {
      const source = inMemoryMessageSource<
        Tested,
        RecordedMessageMetadataWithGlobalPosition
      >({ messages: [] });
      const processor = collectingReactor([]);
      const consumer = postgreSQLEventStoreConsumer<Tested>({
        connectionString,
        source,
      });

      const registered = consumer.reactor(processor);

      assertEqual(registered, processor);
      assertEqual(consumer.processors[0], processor);
      await consumer.close();
    });
  });

  void describe('created by the event store', () => {
    void it('is the strongly typed PostgreSQL consumer', async () => {
      const eventStore = getPostgreSQLEventStore(connectionString);
      const storeConsumer: PostgreSQLEventStoreConsumer = eventStore.consumer();

      try {
        assertEqual(typeof storeConsumer.projector, 'function');
        assertEqual(typeof storeConsumer.reactor, 'function');
        assertEqual(typeof storeConsumer.workflowProcessor, 'function');
      } finally {
        await storeConsumer.close();
        await eventStore.close();
      }
    });
  });
});
