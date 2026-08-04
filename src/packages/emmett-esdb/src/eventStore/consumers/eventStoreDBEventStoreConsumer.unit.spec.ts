import {
  assertEqual,
  assertRejects,
  bigIntProcessorCheckpoint,
  inMemoryMessageSource,
  inMemoryReactor,
  type Event,
  type MessageProcessor,
  type MessageSource,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import { EventStoreDBClient } from '@eventstore/db-client';
import { describe, it, vi } from 'vitest';
import {
  getEventStoreDBEventStore,
  type EventStoreDBReadEventMetadata,
} from '../eventstoreDBEventStore';
import {
  eventStoreDBEventStoreConsumer,
  type EventStoreDBEventStoreConsumer,
} from './eventStoreDBEventStoreConsumer';

const fakeClient = (): {
  client: EventStoreDBClient;
  disposals: () => number;
} => {
  let disposals = 0;

  return {
    disposals: () => disposals,
    client: {
      dispose: () => {
        disposals++;
        return Promise.resolve();
      },
    } as unknown as EventStoreDBClient,
  };
};

void describe('eventStoreDBEventStoreConsumer client ownership', () => {
  void it('disposes the client it created on close', async () => {
    const { client, disposals } = fakeClient();
    const connectionString = vi
      .spyOn(EventStoreDBClient, 'connectionString')
      .mockReturnValue(client);

    try {
      const consumer = eventStoreDBEventStoreConsumer({
        connectionString: 'esdb://localhost:2113?tls=false',
      });

      await consumer.close();

      assertEqual(1, disposals());
    } finally {
      connectionString.mockRestore();
    }
  });

  void it('leaves a client it was given to its owner', async () => {
    const { client, disposals } = fakeClient();

    const consumer = eventStoreDBEventStoreConsumer({ client });

    await consumer.close();

    assertEqual(0, disposals());
  });

  void it('closes a processor that fails to initialise exactly once', async () => {
    const { client } = fakeClient();
    let closes = 0;
    const failure = new Error('Init failed');
    const processor = {
      id: 'failing',
      instanceId: 'failing',
      type: 'reactor',
      isActive: false,
      init: () => Promise.reject(failure),
      start: () => Promise.resolve('BEGINNING'),
      close: () => {
        closes++;
        return Promise.resolve();
      },
      handle: () => Promise.resolve(),
      whenProcessed: () => Promise.resolve(),
    } as MessageProcessor;
    const consumer = eventStoreDBEventStoreConsumer({
      client,
      processors: [processor],
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await assertRejects(consumer.start(), failure);
      await consumer.close();
    } finally {
      log.mockRestore();
    }

    assertEqual(1, closes);
  });
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;

const recordedAt = (
  position: bigint,
): RecordedMessage<GuestCheckedIn, EventStoreDBReadEventMetadata> =>
  ({
    kind: 'Event',
    type: 'GuestCheckedIn',
    data: { guestId: `guest-${position}` },
    metadata: {
      messageId: `message-${position}`,
      streamName: 'guestStay-1',
      streamPosition: position,
      globalPosition: position,
      checkpoint: bigIntProcessorCheckpoint(position),
    },
  }) as unknown as RecordedMessage<
    GuestCheckedIn,
    EventStoreDBReadEventMetadata
  >;

const countingSource = (): {
  source: MessageSource<GuestCheckedIn, EventStoreDBReadEventMetadata>;
  closes: () => number;
} => {
  let closes = 0;
  const source = inMemoryMessageSource<
    GuestCheckedIn,
    EventStoreDBReadEventMetadata
  >({
    messages: [recordedAt(1n), recordedAt(2n)],
  });

  return {
    closes: () => closes,
    source: {
      ...source,
      close: () => {
        closes++;
        return Promise.resolve();
      },
    },
  };
};

void describe('eventStoreDBEventStoreConsumer injected message source', () => {
  void it('consumes messages from the injected source', async () => {
    const { client } = fakeClient();
    const { source } = countingSource();
    const handled: RecordedMessage<
      GuestCheckedIn,
      EventStoreDBReadEventMetadata
    >[] = [];

    const consumer = eventStoreDBEventStoreConsumer<GuestCheckedIn>({
      client,
      source,
    });

    consumer.reactor<GuestCheckedIn>({
      processorId: 'injected-source-reactor',
      checkpoints: 'DISABLED',
      stopAfter: () => handled.length === 2,
      eachMessage: (message) => {
        handled.push(message);
      },
    });

    try {
      await consumer.start();
    } finally {
      await consumer.close();
    }

    assertEqual(2, handled.length);
    assertEqual('GuestCheckedIn', handled[0]!.type);
  });

  void it('leaves an injected source to its owner on close', async () => {
    const { client } = fakeClient();
    const { source, closes } = countingSource();

    const consumer = eventStoreDBEventStoreConsumer<GuestCheckedIn>({
      client,
      source,
    });

    await consumer.close();

    assertEqual(0, closes());
  });

  void it('registers an existing processor through all processor methods', async () => {
    const { client } = fakeClient();
    const { source } = countingSource();
    const processor = inMemoryReactor<GuestCheckedIn>({
      processorId: 'existing-processor',
      eachMessage: () => {},
    });
    const consumer = eventStoreDBEventStoreConsumer<GuestCheckedIn>({
      client,
      source,
    });

    const registered = consumer.reactor(processor);
    const registeredAsProjector = consumer.projector(processor);
    const registeredAsWorkflow = consumer.workflowProcessor(processor);

    assertEqual(processor, registered);
    assertEqual(processor, registeredAsProjector);
    assertEqual(processor, registeredAsWorkflow);
    assertEqual(consumer.processors[0], processor);
    assertEqual(consumer.processors.length, 1);
    await consumer.close();
  });
});

void describe('eventStoreDBEventStore consumer typing', () => {
  void it('returns the EventStoreDB consumer, not the base message consumer', () => {
    const { client } = fakeClient();

    const consumer: EventStoreDBEventStoreConsumer =
      getEventStoreDBEventStore(client).consumer();

    assertEqual('function', typeof consumer.projector);
    assertEqual('function', typeof consumer.reactor);
    assertEqual('function', typeof consumer.workflowProcessor);
  });
});
