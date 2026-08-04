import { InMemorySQLiteDatabase } from '@event-driven-io/dumbo/sqlite3';
import {
  assertEqual,
  assertThatArray,
  inMemoryMessageSource,
  ProcessorCheckpoint,
  reactor,
  type Event,
  type MessageSource,
  type ReadEventMetadataWithGlobalPosition,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { describe, it } from 'vitest';
import { sqlite3EventStoreDriver } from '../../sqlite3';
import { getSQLiteEventStore } from '../SQLiteEventStore';
import {
  sqliteEventStoreConsumer,
  type SQLiteEventStoreConsumer,
} from './sqliteEventStoreConsumer';

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;

const recorded = (
  event: GuestStayEvent,
  globalPosition: bigint,
): RecordedMessage<GuestStayEvent, ReadEventMetadataWithGlobalPosition> =>
  ({
    ...event,
    kind: 'Event',
    metadata: {
      checkpoint: ProcessorCheckpoint(globalPosition.toString()),
      globalPosition,
      streamName: `guestStay-${event.data.guestId}`,
      streamPosition: globalPosition,
      messageId: uuid(),
    },
  }) as unknown as RecordedMessage<
    GuestStayEvent,
    ReadEventMetadataWithGlobalPosition
  >;

void describe('SQLite event store consumer with injected message source', () => {
  const guestId = uuid();
  const events: GuestStayEvent[] = [
    { type: 'GuestCheckedIn', data: { guestId } },
    { type: 'GuestCheckedOut', data: { guestId } },
  ];

  const injectedSource = (): {
    source: MessageSource<GuestStayEvent, ReadEventMetadataWithGlobalPosition>;
    closes: () => number;
  } => {
    let closes = 0;
    const source = inMemoryMessageSource<
      GuestStayEvent,
      ReadEventMetadataWithGlobalPosition
    >({
      messages: events.map((event, index) =>
        recorded(event, BigInt(index + 1)),
      ),
    });

    return {
      source: {
        ...source,
        close: () => {
          closes++;
          return Promise.resolve();
        },
      },
      closes: () => closes,
    };
  };

  void it('handles messages read from the injected source', async () => {
    const { source } = injectedSource();
    const result: GuestStayEvent[] = [];

    const consumer = sqliteEventStoreConsumer<
      GuestStayEvent,
      typeof sqlite3EventStoreDriver
    >({
      driver: sqlite3EventStoreDriver,
      fileName: InMemorySQLiteDatabase,
      source,
    });
    consumer.reactor<GuestStayEvent>({
      processorId: uuid(),
      checkpoints: 'DISABLED',
      eachMessage: (event) => {
        result.push(event);
      },
    });

    let consumerPromise: Promise<void> | undefined;
    try {
      consumerPromise = consumer.start();
      await consumer.whenCaughtUp();

      assertThatArray(result).containsOnlyElementsMatching(events);
    } finally {
      await consumer.close();
      await consumerPromise;
    }
  });

  void it('does NOT close the injected source when consumer is closed', async () => {
    const { source, closes } = injectedSource();

    const consumer = sqliteEventStoreConsumer<
      GuestStayEvent,
      typeof sqlite3EventStoreDriver
    >({
      driver: sqlite3EventStoreDriver,
      fileName: InMemorySQLiteDatabase,
      source,
    });
    consumer.reactor<GuestStayEvent>({
      processorId: uuid(),
      checkpoints: 'DISABLED',
      eachMessage: () => {},
    });

    const consumerPromise = consumer.start();
    await consumer.whenCaughtUp();
    await consumer.close();
    await consumerPromise;

    assertEqual(closes(), 0);
  });

  void it('registers an existing processor through reactor', async () => {
    const { source } = injectedSource();
    const processor = reactor<GuestStayEvent>({
      processorId: uuid(),
      checkpoints: 'DISABLED',
      eachMessage: () => {},
    });
    const consumer = sqliteEventStoreConsumer<
      GuestStayEvent,
      typeof sqlite3EventStoreDriver
    >({
      driver: sqlite3EventStoreDriver,
      fileName: InMemorySQLiteDatabase,
      source,
    });

    const registered = consumer.reactor(processor);

    assertEqual(registered, processor);
    assertEqual(consumer.processors[0], processor);
    await consumer.close();
  });

  void it('event store returns the strongly typed SQLite consumer', () => {
    const eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName: InMemorySQLiteDatabase,
    });

    const consumer: SQLiteEventStoreConsumer = eventStore.consumer();

    assertEqual(typeof consumer.projector, 'function');
    assertEqual(typeof consumer.reactor, 'function');
    assertEqual(typeof consumer.workflowProcessor, 'function');
  });
});
