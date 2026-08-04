import {
  assertEqual,
  assertFalse,
  assertThatArray,
  inMemoryMessageSource,
  inMemoryReactor,
  ProcessorCheckpoint,
  type Event,
  type MessageSource,
  type RecordedMessage,
  type WorkflowOptions,
} from '@event-driven-io/emmett';
import { MongoClient } from 'mongodb';
import { v4 as uuid } from 'uuid';
import { describe, it, vi } from 'vitest';
import { mongoDBEventStoreConsumer as packageRootConsumer } from '../../index';
import {
  GroupCheckoutWorkflow,
  type GroupCheckout,
  type GroupCheckoutInput,
  type GroupCheckoutOutput,
} from '../../testing/groupCheckout.domain';
import { getMongoDBEventStore } from '../mongoDBEventStore';
import {
  mongoDBEventStoreConsumer,
  type MongoDBChangeStreamMessageMetadata,
  type MongoDBEventStoreConsumer,
} from './mongoDBEventStoreConsumer';
import { mongoDBWorkflowProcessor } from './mongoDBProcessor';

vi.mock('./mongoDBProcessor', async (importOriginal) => {
  const actual = await importOriginal<{
    mongoDBWorkflowProcessor: typeof mongoDBWorkflowProcessor;
  }>();

  return {
    ...actual,
    mongoDBWorkflowProcessor: vi.fn(actual.mongoDBWorkflowProcessor),
  };
});

type NumberRecorded = Event<'NumberRecorded', { number: number }>;

const connectionString = 'mongodb://localhost:27017/emmett_unit_tests';

const workflowProcessorOptions: WorkflowOptions<
  GroupCheckoutInput,
  GroupCheckout,
  GroupCheckoutOutput
> = {
  workflow: GroupCheckoutWorkflow,
  getWorkflowId: (input) =>
    (input.data as { groupCheckoutId?: string }).groupCheckoutId ?? null,
  inputs: {
    commands: ['InitiateGroupCheckout', 'TimeoutGroupCheckout'],
    events: ['GuestCheckedOut', 'GuestCheckoutFailed'],
  },
  outputs: {
    commands: ['CheckOut'],
    events: [
      'GroupCheckoutCompleted',
      'GroupCheckoutFailed',
      'GroupCheckoutTimedOut',
    ],
  },
};

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

  void it('passes its resolved client to the workflow processor', async () => {
    const workflowProcessor = vi.mocked(mongoDBWorkflowProcessor);
    workflowProcessor.mockClear();
    const consumer = mongoDBEventStoreConsumer<
      GroupCheckoutInput | GroupCheckoutOutput
    >({
      connectionString,
    });

    try {
      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
      });

      assertEqual(1, workflowProcessor.mock.calls.length);
      assertEqual(
        true,
        'client' in workflowProcessor.mock.calls[0]![0].connectionOptions,
      );
    } finally {
      await consumer.close();
    }
  });

  void it('is exposed from the package root', () => {
    assertEqual(typeof packageRootConsumer, 'function');
  });
});

void describe('mongoDB workflow processor client ownership', () => {
  void it('closes the client it creates from a connection string', async () => {
    const close = vi.spyOn(MongoClient.prototype, 'close').mockResolvedValue();

    try {
      const processor = mongoDBWorkflowProcessor({
        ...workflowProcessorOptions,
        connectionOptions: { connectionString },
      });

      await processor.close();

      assertEqual(1, close.mock.calls.length);
    } finally {
      close.mockRestore();
    }
  });

  void it('leaves an injected client to its owner', async () => {
    const client = new MongoClient(connectionString);
    const close = vi.spyOn(client, 'close').mockResolvedValue();

    try {
      const processor = mongoDBWorkflowProcessor({
        ...workflowProcessorOptions,
        connectionOptions: { client },
      });

      await processor.close();

      assertEqual(0, close.mock.calls.length);
    } finally {
      close.mockRestore();
      await client.close();
    }
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
