import {
  assertEqual,
  assertFalse,
  assertThatArray,
  assertThrows,
  inMemoryMessageSource,
  inMemoryReactor,
  ProcessorCheckpoint,
  type Event,
  type MessageSource,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { describe, it } from 'vitest';
import { mongoDBEventStoreConsumer as packageRootConsumer } from '../../index';
import { getMongoDBEventStore } from '../mongoDBEventStore';
import {
  mongoDBEventStoreConsumer,
  type MongoDBChangeStreamMessageMetadata,
  type MongoDBEventStoreConsumer,
} from './mongoDBEventStoreConsumer';

type NumberRecorded = Event<'NumberRecorded', { number: number }>;

const connectionString = 'mongodb://localhost:27017/emmett_unit_tests';

const messageAt = (
  number: number,
): RecordedMessage<NumberRecorded, MongoDBChangeStreamMessageMetadata> =>
  ({
    type: 'NumberRecorded',
    data: { number },
    metadata: { checkpoint: ProcessorCheckpoint(`${number}`) },
  }) as unknown as RecordedMessage<
    NumberRecorded,
    MongoDBChangeStreamMessageMetadata
  >;

const borrowedSource = (
  messages: RecordedMessage<
    NumberRecorded,
    MongoDBChangeStreamMessageMetadata
  >[],
): {
  source: MessageSource<NumberRecorded, MongoDBChangeStreamMessageMetadata>;
  wasClosed: () => boolean;
} => {
  let closed = false;
  const source = inMemoryMessageSource<
    NumberRecorded,
    MongoDBChangeStreamMessageMetadata
  >({ messages });

  return {
    source: {
      ...source,
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    },
    wasClosed: () => closed,
  };
};

void describe('mongoDB event store consumer', () => {
  void it('processes messages from the injected message source', async () => {
    const { source } = borrowedSource([messageAt(1), messageAt(2)]);
    const handled: NumberRecorded[] = [];

    const consumer = mongoDBEventStoreConsumer<NumberRecorded>({
      connectionString,
      source,
      until: { noMessagesLeft: true },
      processors: [
        inMemoryReactor<NumberRecorded>({
          processorId: uuid(),
          eachMessage: (message) => {
            handled.push(message);
          },
        }),
      ],
    });

    try {
      await consumer.start();

      assertThatArray(
        handled.map((m) => m.data.number),
      ).containsExactlyElementsOf([1, 2]);
    } finally {
      await consumer.close();
    }
  });

  void it('does NOT close the injected message source', async () => {
    const { source, wasClosed } = borrowedSource([messageAt(1)]);

    const consumer = mongoDBEventStoreConsumer<NumberRecorded>({
      connectionString,
      source,
      until: { noMessagesLeft: true },
      processors: [
        inMemoryReactor<NumberRecorded>({
          processorId: uuid(),
          eachMessage: () => {},
        }),
      ],
    });

    await consumer.start();
    await consumer.close();

    assertFalse(wasClosed());
  });

  void it('registers an existing processor through all processor methods', async () => {
    const { source } = borrowedSource([]);
    const processor = inMemoryReactor<NumberRecorded>({
      processorId: uuid(),
      eachMessage: () => {},
    });
    const consumer = mongoDBEventStoreConsumer<NumberRecorded>({
      connectionString,
      source,
    });

    const registered = consumer.reactor(processor);
    const registeredAsProjector = consumer.projector(processor);
    const registeredAsWorkflow = consumer.workflowProcessor(processor);

    assertEqual(registered, processor);
    assertEqual(registeredAsProjector, processor);
    assertEqual(registeredAsWorkflow, processor);
    assertEqual(consumer.processors[0], processor);
    assertEqual(consumer.processors.length, 1);
    await consumer.close();
  });

  void it('is exposed from the package root', () => {
    assertEqual(typeof packageRootConsumer, 'function');
  });
});

void describe('mongoDB event store consumer created by the event store', () => {
  void it('returns a strongly typed MongoDB consumer', async () => {
    const eventStore = getMongoDBEventStore({ connectionString });

    try {
      const consumer: MongoDBEventStoreConsumer = eventStore.consumer();

      assertEqual(typeof consumer.reactor, 'function');
      assertEqual(typeof consumer.projector, 'function');
      assertEqual(typeof consumer.workflowProcessor, 'function');
      assertThrows(() => consumer.workflowProcessor({ workflow: {} }));
    } finally {
      await eventStore.close();
    }
  });

  void it('returns a NEW consumer instance on each call', async () => {
    const eventStore = getMongoDBEventStore({ connectionString });

    try {
      const first = eventStore.consumer();
      const second = eventStore.consumer();

      assertFalse(first === second);
      assertFalse(first.consumerId === second.consumerId);
    } finally {
      await eventStore.close();
    }
  });
});
