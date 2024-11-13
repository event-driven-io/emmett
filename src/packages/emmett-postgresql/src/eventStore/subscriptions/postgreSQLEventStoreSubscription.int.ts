import {
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
  postgreSQLEventStoreSubscription,
  type PostgreSQLEventStoreSubscription,
} from './postgreSQLEventStoreSubscription';

void describe('PostgreSQL event store subscriptions', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    connectionString = postgres.getConnectionUri();
  });

  after(async () => {
    try {
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('creates not-started subscription for the specified connection string', () => {
    const subscription = postgreSQLEventStoreSubscription({ connectionString });

    assertFalse(subscription.isRunning);
  });

  void it('creates not-started subscription if connection string targets not existing PostgreSQL database', () => {
    const connectionStringToNotExistingDB =
      'postgresql://postgres:postgres@not-existing-database:5432/postgres';
    const subscription = postgreSQLEventStoreSubscription({
      connectionString: connectionStringToNotExistingDB,
    });

    assertFalse(subscription.isRunning);
  });

  void describe('created subscription', () => {
    let subscription: PostgreSQLEventStoreSubscription;

    beforeEach(() => {
      subscription = postgreSQLEventStoreSubscription({ connectionString });
    });
    afterEach(() => subscription.stop());

    void it('subscribes to exsiting event store', async () => {
      await subscription.subscribe();

      assertTrue(subscription.isRunning);
    });

    void it('fails to subscribe if connection string targets not existing PostgreSQL database', async () => {
      const connectionStringToNotExistingDB =
        'postgresql://postgres:postgres@not-existing-database:5432/postgres';
      const subscriptionToNotExistingServer = postgreSQLEventStoreSubscription({
        connectionString: connectionStringToNotExistingDB,
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
      subscription = postgreSQLEventStoreSubscription({ connectionString });
    });
    afterEach(() => subscription.stop());

    void it('stops started subscription', async () => {
      await subscription.stop();

      assertFalse(subscription.isRunning);
    });
  });
});
