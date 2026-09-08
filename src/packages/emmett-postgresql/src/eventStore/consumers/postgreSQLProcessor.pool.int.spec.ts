import { dumbo, type Dumbo } from '@event-driven-io/dumbo';
import { pgDumboDriver } from '@event-driven-io/dumbo/pg';
import { assertFalse, assertTrue, type Event } from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { pgEventStoreDriver } from '../../pg';
import {
  isolatedPostgreSQLDatabase,
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../testing/postgreSQLTestDatabase';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import { postgreSQLEventStoreConsumer } from './postgreSQLEventStoreConsumer';

const withDeadline = { timeout: 60000 };

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;

void describe('PostgreSQL processor pool', () => {
  let consumerDatabase: PostgreSQLTestDatabase;
  let otherDatabase: PostgreSQLTestDatabase;
  let eventStore: PostgresEventStore;
  let otherEventStore: PostgresEventStore;

  beforeAll(async () => {
    consumerDatabase = await isolatedPostgreSQLDatabase();
    otherDatabase = await sharedPostgreSQLDatabase();

    eventStore = getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString: consumerDatabase.connectionString,
    });
    await eventStore.schema.migrate();

    otherEventStore = getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString: otherDatabase.connectionString,
    });
    await otherEventStore.schema.migrate();
  });

  afterAll(async () => {
    try {
      await eventStore?.close();
      await otherEventStore?.close();
      await consumerDatabase?.close();
      await otherDatabase?.close();
    } catch (error) {
      console.log(error);
    }
  });

  const poolSeenBy = async (
    processorConnectionString?: string,
  ): Promise<{ consumerPool: Dumbo; seenPool: Dumbo | undefined }> => {
    const consumerPool = dumbo({
      driver: pgDumboDriver,
      connectionString: consumerDatabase.connectionString,
      transactionOptions: { allowNestedTransactions: true },
    });

    let seenPool: Dumbo | undefined;

    const consumer = postgreSQLEventStoreConsumer<GuestCheckedIn>({
      driver: pgEventStoreDriver,
      pool: consumerPool,
      stopWhen: { noMessagesLeft: true },
    });

    consumer.reactor<GuestCheckedIn>({
      processorId: uuid(),
      startFrom: 'BEGINNING',
      canHandle: ['GuestCheckedIn'],
      connectionOptions: processorConnectionString
        ? { connectionString: processorConnectionString }
        : undefined,
      eachMessage: (_message, context) => {
        seenPool = context.session.pool;
      },
    });

    await eventStore.appendToStream(`guestStay-${uuid()}`, [
      { type: 'GuestCheckedIn', data: { guestId: uuid() } },
    ]);

    try {
      await consumer.start();
    } finally {
      await consumer.close();
      await consumerPool.close();
    }

    return { consumerPool, seenPool };
  };

  void it(
    'uses the consumer pool when the processor has no connection options',
    withDeadline,
    async () => {
      const { consumerPool, seenPool } = await poolSeenBy();

      assertTrue(seenPool === consumerPool);
    },
  );

  void it(
    'opens its own pool when the processor has connection options',
    withDeadline,
    async () => {
      const { consumerPool, seenPool } = await poolSeenBy(
        otherDatabase.connectionString,
      );

      assertTrue(seenPool !== undefined);
      assertFalse(seenPool === consumerPool);
    },
  );
});
