import { dumbo, SQL, type Dumbo } from '@event-driven-io/dumbo';
import {
  assertDeepEqual,
  assertEqual,
  projections,
  type Event,
} from '@event-driven-io/emmett';
import { postgreSQLProjection } from '../projections';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../testing/postgreSQLTestDatabase';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import { postgreSQLEventStoreConsumer } from './postgreSQLEventStoreConsumer';
import { pgDumboDriver } from '@event-driven-io/dumbo/pg';
import { pgEventStoreDriver } from '../../pg';

const withDeadline = { timeout: 30000 };

void describe('PostgreSQL processor transaction handling', () => {
  let database: PostgreSQLTestDatabase;
  let connectionString: string;
  let eventStore: PostgresEventStore;
  let observerPool: Dumbo;

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
    connectionString = database.connectionString;
    eventStore = getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString: connectionString,
    });
    await eventStore.schema.migrate();
    observerPool = dumbo({
      driver: pgDumboDriver,
      connectionString,
    });
  }, 120000);

  beforeEach(async () => {
    await eventStore.schema.dangerous.truncate({
      resetSequences: true,
      truncateProjections: true,
    });
  });

  afterAll(async () => {
    try {
      await observerPool?.close();
      await eventStore?.close();
      await database?.close();
    } catch (error) {
      console.log(error);
    }
  });

  void it(
    'keeps messages appended through the handler context uncommitted until the processing transaction commits',
    withDeadline,
    async () => {
      // Given
      const guestId = uuid();
      const reactionStream = `reaction-${guestId}`;
      const appendResult = await eventStore.appendToStream(
        `guestStay-${guestId}`,
        [{ type: 'GuestCheckedIn', data: { guestId } }],
      );

      const visibleToOtherConnectionsDuringHandling: number[] = [];

      // When
      const consumer = postgreSQLEventStoreConsumer({ connectionString });
      consumer.reactor<GuestStayEvent>({
        processorId: uuid(),
        stopAfter: (event) =>
          event.metadata.globalPosition ===
          appendResult.lastEventGlobalPosition,
        eachMessage: async (event, context) => {
          await context.session.messageStore.appendToStream(reactionStream, [
            { type: 'GuestCheckedOut', data: { guestId: event.data.guestId } },
          ]);

          const seen = await observerPool.execute.query<{ count: number }>(
            SQL`SELECT COUNT(*)::int AS count FROM emt_messages WHERE stream_id = ${reactionStream}`,
          );
          visibleToOtherConnectionsDuringHandling.push(seen.rows[0]!.count);
        },
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      // Then
      assertEqual(1, visibleToOtherConnectionsDuringHandling.length);
      assertEqual(0, visibleToOtherConnectionsDuringHandling[0]);

      const committed = await observerPool.execute.query<{ count: number }>(
        SQL`SELECT COUNT(*)::int AS count FROM emt_messages WHERE stream_id = ${reactionStream}`,
      );
      assertEqual(1, committed.rows[0]!.count);
    },
  );

  void it(
    'rolls back the whole batch and keeps the checkpoint before it when a handler throws',
    withDeadline,
    async () => {
      // Given
      const guestId = uuid();
      const otherGuestId = uuid();
      const reactionStream = `reaction-${guestId}`;
      const processorId = uuid();

      await eventStore.appendToStream(`guestStay-${guestId}`, [
        { type: 'GuestCheckedIn', data: { guestId } },
        { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
      ]);

      const consumer = postgreSQLEventStoreConsumer({ connectionString });
      consumer.reactor<GuestStayEvent>({
        processorId,
        canHandle: ['GuestCheckedIn'],
        eachMessage: async (event, context) => {
          await context.session.messageStore.appendToStream(reactionStream, [
            { type: 'GuestCheckedOut', data: { guestId: event.data.guestId } },
          ]);
          if (event.data.guestId === otherGuestId)
            throw new Error('handler failed');
        },
      });

      // When
      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      // Then
      const reactions = await observerPool.execute.query<{ count: number }>(
        SQL`SELECT COUNT(*)::int AS count FROM emt_messages WHERE stream_id = ${reactionStream}`,
      );
      assertEqual(0, reactions.rows[0]!.count);

      const checkpoints = await observerPool.execute.query<{
        last_processed_checkpoint: string;
      }>(
        SQL`SELECT last_processed_checkpoint FROM emt_processors WHERE processor_id = ${processorId}`,
      );
      assertEqual(
        '0000000000000000000',
        checkpoints.rows[0]?.last_processed_checkpoint,
      );
    },
  );
  void it(
    'handles the rolled back batch again when the consumer starts again',
    withDeadline,
    async () => {
      // Given
      const guestId = uuid();
      const otherGuestId = uuid();
      const reactionStream = `reaction-${guestId}`;
      let failed = false;

      await eventStore.appendToStream(`guestStay-${guestId}`, [
        { type: 'GuestCheckedIn', data: { guestId } },
        { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
      ]);

      const consumer = postgreSQLEventStoreConsumer({ connectionString });
      consumer.reactor<GuestStayEvent>({
        processorId: uuid(),
        canHandle: ['GuestCheckedIn'],
        stopAfter: (event) => event.data.guestId === otherGuestId,
        eachMessage: async (event, context) => {
          await context.session.messageStore.appendToStream(reactionStream, [
            { type: 'GuestCheckedOut', data: { guestId: event.data.guestId } },
          ]);
          if (event.data.guestId === otherGuestId && !failed) {
            failed = true;
            throw new Error('handler failed');
          }
        },
      });

      // When
      try {
        await consumer.start();
        await consumer.start();
      } finally {
        await consumer.close();
      }

      // Then
      const { events } = await eventStore.readStream(reactionStream);
      assertDeepEqual(
        events.map(({ data }) => data),
        [{ guestId }, { guestId: otherGuestId }],
      );
    },
  );

  void it(
    'runs the inline projections and the commit hook of the store for appends through the handler context',
    withDeadline,
    async () => {
      // Given
      const guestId = uuid();
      const reactionStream = `reaction-${guestId}`;
      const appendResult = await eventStore.appendToStream(
        `guestStay-${guestId}`,
        [{ type: 'GuestCheckedIn', data: { guestId } }],
      );
      const projected: string[] = [];
      const hooked: string[] = [];
      let handled = false;

      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString,
        projections: projections.inline([
          postgreSQLProjection<GuestCheckedOut>({
            name: `reactions_${uuid().replaceAll('-', '_')}`,
            canHandle: ['GuestCheckedOut'],
            handle: (events) => {
              projected.push(...events.map((event) => event.data.guestId));
            },
          }),
        ]),
        hooks: {
          onBeforeCommit: (messages): void => {
            hooked.push(...messages.map((message) => message.type));
          },
        },
      });
      const consumer = store.consumer();
      consumer.reactor<GuestStayEvent>({
        processorId: uuid(),
        canHandle: ['GuestCheckedIn'],
        stopAfter: (event) =>
          event.metadata.globalPosition ===
          appendResult.lastEventGlobalPosition,
        eachMessage: async (event, context) => {
          await context.session.messageStore.appendToStream(reactionStream, [
            { type: 'GuestCheckedOut', data: { guestId: event.data.guestId } },
          ]);
          handled = true;
        },
      });

      // When
      try {
        await consumer.start();
      } finally {
        await consumer.close();
        await store.close();
      }

      // Then
      assertEqual(true, handled);
      assertDeepEqual([guestId], projected);
      assertEqual(true, hooked.includes('GuestCheckedOut'));
    },
  );
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;
