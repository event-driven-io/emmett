import {
  assertFails,
  assertFalse,
  assertThrowsAsync,
  assertTrue,
} from '@event-driven-io/emmett';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import {
  postgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumer,
} from './postgreSQLEventStoreConsumer';
import type { PostgreSQLEventStoreSubscription } from './postgreSQLEventStoreSubscription';

void describe('PostgreSQL event store consumer', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let eventStore: PostgresEventStore;
  const dummySubscription: PostgreSQLEventStoreSubscription = {
    handle: () => Promise.resolve(),
    isActive: false,
  };

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    connectionString = postgres.getConnectionUri();
    eventStore = getPostgreSQLEventStore(connectionString);
    await eventStore.schema.migrate();
  });

  after(async () => {
    try {
      await eventStore.close();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('creates not-started consumer for the specified connection string', () => {
    const consumer = postgreSQLEventStoreConsumer({
      connectionString,
      subscriptions: [dummySubscription],
    });

    assertFalse(consumer.isRunning);
  });

  void it('creates not-started consumer if connection string targets not existing PostgreSQL database', () => {
    const connectionStringToNotExistingDB =
      'postgresql://postgres:postgres@not-existing-database:5432/postgres';
    const consumer = postgreSQLEventStoreConsumer({
      connectionString: connectionStringToNotExistingDB,
      subscriptions: [dummySubscription],
    });

    assertFalse(consumer.isRunning);
  });

  void describe('created consumer', () => {
    let consumer: PostgreSQLEventStoreConsumer;

    beforeEach(() => {
      consumer = postgreSQLEventStoreConsumer({
        connectionString,
        subscriptions: [dummySubscription],
      });
    });
    afterEach(() => consumer.stop());

    void it('subscribes to existing event store', () => {
      consumer.start().catch(() => assertFails());

      assertTrue(consumer.isRunning);
    });

    void it('fails to start if connection string targets not existing PostgreSQL database', async () => {
      const connectionStringToNotExistingDB =
        'postgresql://postgres:postgres@not-existing-database:5432/postgres';
      const consumerToNotExistingServer = postgreSQLEventStoreConsumer({
        connectionString: connectionStringToNotExistingDB,
        subscriptions: [dummySubscription],
      });
      await assertThrowsAsync(() => consumerToNotExistingServer.start());
    });

    void it(`stopping not started consumer doesn't fail`, async () => {
      await consumer.stop();

      assertFalse(consumer.isRunning);
    });

    void it(`stopping not started consumer is idempotent`, async () => {
      await consumer.stop();
      await consumer.stop();

      assertFalse(consumer.isRunning);
    });
  });

  void describe('started consumer', () => {
    let consumer: PostgreSQLEventStoreConsumer;

    beforeEach(() => {
      consumer = postgreSQLEventStoreConsumer({
        connectionString,
        subscriptions: [dummySubscription],
      });
    });
    afterEach(() => consumer.stop());

    void it('stops started consumer', async () => {
      await consumer.stop();

      assertFalse(consumer.isRunning);
    });
  });
});
