import { assertThatArray, type Event } from '@event-driven-io/emmett';
import {
  getSQLiteEventStore,
  sqliteEventStoreConsumer,
} from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { v4 as uuid } from 'uuid';
import { describe, it } from 'vitest';

type GuestStayEvent = Event<
  'GuestCheckedIn' | 'GuestCheckedOut',
  { guestId: string }
>;

const fileName = `guestStay-${uuid()}.db`;

void describe('Testing async consumers', () => {
  void it('waits until the consumer catches up', async () => {
    const eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName,
    });

    // #region await-caught-up
    const processed: GuestStayEvent[] = [];

    const consumer = sqliteEventStoreConsumer({
      driver: sqlite3EventStoreDriver,
      fileName,
    });
    consumer.reactor<GuestStayEvent>({
      processorId: uuid(),
      eachMessage: (event) => {
        processed.push(event);
      },
    });

    const guestId = uuid();
    const events: GuestStayEvent[] = [
      { type: 'GuestCheckedIn', data: { guestId } },
      { type: 'GuestCheckedOut', data: { guestId } },
    ];

    let consumerPromise: Promise<void> | undefined;
    try {
      consumerPromise = consumer.start();
      await consumer.whenStarted();

      await eventStore.appendToStream(`guestStay-${guestId}`, events);

      // resolves once every processor has reached the store's tail
      await consumer.whenCaughtUp();

      assertThatArray(processed).containsElementsMatching(events);
    } finally {
      await consumer.close();
      await consumerPromise;
    }
    // #endregion await-caught-up
  });

  void it('waits for a specific appended position', async () => {
    const eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName,
    });
    const consumer = sqliteEventStoreConsumer({
      driver: sqlite3EventStoreDriver,
      fileName,
    });
    const guestId = uuid();
    consumer.reactor<GuestStayEvent>({
      processorId: uuid(),
      eachMessage: () => {},
    });

    let consumerPromise: Promise<void> | undefined;
    try {
      consumerPromise = consumer.start();
      await consumer.whenStarted();

      // #region await-processed
      const appendResult = await eventStore.appendToStream(
        `guestStay-${guestId}`,
        [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ],
      );

      await consumer.whenProcessed(appendResult.lastEventGlobalPosition);
      // #endregion await-processed
    } finally {
      await consumer.close();
      await consumerPromise;
    }
  });

  void it('fails fast instead of hanging', async () => {
    const consumer = sqliteEventStoreConsumer({
      driver: sqlite3EventStoreDriver,
      fileName,
    });
    consumer.reactor<GuestStayEvent>({
      processorId: uuid(),
      eachMessage: () => {},
    });

    let consumerPromise: Promise<void> | undefined;
    try {
      consumerPromise = consumer.start();
      await consumer.whenStarted();

      // #region with-timeout
      // rejects with a descriptive error after 5s rather than hanging
      await consumer.whenCaughtUp({ timeout: 5000 });
      // #endregion with-timeout
    } finally {
      await consumer.close();
      await consumerPromise;
    }
  });
});
