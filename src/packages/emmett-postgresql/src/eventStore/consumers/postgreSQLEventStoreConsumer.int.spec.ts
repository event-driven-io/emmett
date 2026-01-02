import {
  assertFails,
  assertFalse,
  assertThrowsAsync,
  assertTrue,
  EmmettError,
  MessageProcessorType,
} from '@event-driven-io/emmett';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import {
  postgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumer,
} from './postgreSQLEventStoreConsumer';
import type { PostgreSQLProcessor } from './postgreSQLProcessor';

const withDeadline = { timeout: 30000 };

void describe('PostgreSQL event store consumer', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let eventStore: PostgresEventStore;
  const dummyProcessor: PostgreSQLProcessor = {
    type: MessageProcessorType.REACTOR,
    id: uuid(),
    start: () => Promise.resolve('BEGINNING'),
    close: () => Promise.resolve(),
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

  void it(
    'creates not-started consumer for the specified connection string',
    withDeadline,
    async () => {
      const consumer = postgreSQLEventStoreConsumer({
        connectionString,
        processors: [dummyProcessor],
      });

      assertFalse(consumer.isRunning);

      await consumer.close();
    },
  );

  void it(
    'creates not-started consumer if connection string targets not existing PostgreSQL database',
    withDeadline,
    async () => {
      const connectionStringToNotExistingDB =
        'postgresql://postgres:postgres@not-existing-database:5432/postgres';
      const consumer = postgreSQLEventStoreConsumer({
        connectionString: connectionStringToNotExistingDB,
        processors: [dummyProcessor],
      });

      assertFalse(consumer.isRunning);

      await consumer.close();
    },
  );

  void describe('created consumer', withDeadline, () => {
    let consumer: PostgreSQLEventStoreConsumer;

    beforeEach(() => {
      consumer = postgreSQLEventStoreConsumer({
        connectionString,
        processors: [dummyProcessor],
      });
    });
    afterEach(() => consumer.close());

    void it('subscribes to existing event store', () => {
      consumer.start().catch(() => assertFails());

      assertTrue(consumer.isRunning);
    });

    void it(
      'fails to start if connection string targets not existing PostgreSQL database',
      withDeadline,
      async () => {
        const connectionStringToNotExistingDB =
          'postgresql://postgres:postgres@not-existing-database:5432/postgres';
        const consumerToNotExistingServer = postgreSQLEventStoreConsumer({
          connectionString: connectionStringToNotExistingDB,
          processors: [dummyProcessor],
        });
        await assertThrowsAsync(
          () => consumerToNotExistingServer.start(),
          (error) => {
            return 'code' in error && error.code === 'EAI_AGAIN';
          },
        );
      },
    );

    void it(
      'fails to start if there are no processors',
      withDeadline,
      async () => {
        const consumerToNotExistingServer = postgreSQLEventStoreConsumer({
          connectionString,
          processors: [],
        });
        await assertThrowsAsync<EmmettError>(
          () => consumerToNotExistingServer.start(),
          (error) => {
            return (
              error.message ===
              'Cannot start consumer without at least a single processor'
            );
          },
        );

        await consumerToNotExistingServer.close();
      },
    );

    void it(
      `stopping not started consumer doesn't fail`,
      withDeadline,
      async () => {
        await consumer.stop();

        assertFalse(consumer.isRunning);
      },
    );

    void it(
      `stopping not started consumer is idempotent`,
      withDeadline,
      async () => {
        await consumer.stop();
        await consumer.stop();

        assertFalse(consumer.isRunning);
      },
    );
  });

  void describe('started consumer', () => {
    let consumer: PostgreSQLEventStoreConsumer;

    beforeEach(() => {
      consumer = postgreSQLEventStoreConsumer({
        connectionString,
        processors: [dummyProcessor],
      });
      void consumer.start();
    });
    afterEach(() => consumer.close());

    void it('stops started consumer', async () => {
      await consumer.stop();

      assertFalse(consumer.isRunning);
    });
  });
});
