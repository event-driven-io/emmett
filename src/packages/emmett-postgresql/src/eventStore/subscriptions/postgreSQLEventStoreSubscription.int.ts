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
  postgreSQLEventStoreSubscription,
  type PostgreSQLEventStoreSubscription,
} from './postgreSQLEventStoreSubscription';

void describe('PostgreSQL event store subscriptions', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let eventStore: PostgresEventStore;

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

  void it('creates not-started subscription for the specified connection string', () => {
    const subscription = postgreSQLEventStoreSubscription({
      connectionString,
      eachMessage: () => {},
    });

    assertFalse(subscription.isRunning);
  });

  void it('creates not-started subscription if connection string targets not existing PostgreSQL database', () => {
    const connectionStringToNotExistingDB =
      'postgresql://postgres:postgres@not-existing-database:5432/postgres';
    const subscription = postgreSQLEventStoreSubscription({
      connectionString: connectionStringToNotExistingDB,
      eachMessage: () => {},
    });

    assertFalse(subscription.isRunning);
  });

  void describe('created subscription', () => {
    let subscription: PostgreSQLEventStoreSubscription;

    beforeEach(() => {
      subscription = postgreSQLEventStoreSubscription({
        connectionString,
        eachMessage: () => {},
      });
    });
    afterEach(() => subscription.stop());

    void it('subscribes to existing event store', () => {
      subscription.subscribe().catch(() => assertFails());

      assertTrue(subscription.isRunning);
    });

    void it('fails to subscribe if connection string targets not existing PostgreSQL database', async () => {
      const connectionStringToNotExistingDB =
        'postgresql://postgres:postgres@not-existing-database:5432/postgres';
      const subscriptionToNotExistingServer = postgreSQLEventStoreSubscription({
        connectionString: connectionStringToNotExistingDB,
        eachMessage: () => {},
      });
      await assertThrowsAsync(() =>
        subscriptionToNotExistingServer.subscribe(),
      );
    });

    void it(`stopping not started subscription doesn't fail`, async () => {
      await subscription.stop();

      assertFalse(subscription.isRunning);
    });

    void it(`stopping not started subscription is idempotent`, async () => {
      await subscription.stop();
      await subscription.stop();

      assertFalse(subscription.isRunning);
    });
  });

  void describe('started subscription', () => {
    let subscription: PostgreSQLEventStoreSubscription;

    beforeEach(() => {
      subscription = postgreSQLEventStoreSubscription({
        connectionString,
        eachMessage: () => {},
      });
    });
    afterEach(() => subscription.stop());

    void it('stops started subscription', async () => {
      await subscription.stop();

      assertFalse(subscription.isRunning);
    });
  });
});
