import type { DurableObjectStorage } from '@cloudflare/workers-types';
import {
  cloudflareDurableObjectSQLiteConnection,
  cloudflareDurableObjectSQLitePool,
  type CloudflareDurableObjectSQLiteConnection,
  type CloudflareDurableObjectSQLiteConnectionPool,
} from '@event-driven-io/dumbo/cloudflare';
import type { EmmettError } from '@event-driven-io/emmett';
import {
  assertFalse,
  assertThrowsAsync,
  assertTrue,
  JSONSerializer,
  MessageProcessorType,
} from '@event-driven-io/emmett';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { v4 as uuid } from 'uuid';
import { afterEach, aroundEach, beforeEach, describe, it } from 'vitest';
import { durableObjectEventStoreDriver } from '../..';
import { createEventStoreSchema } from '../../../../eventStore/schema';
import {
  sqliteEventStoreConsumer,
  type SQLiteEventStoreConsumer,
} from '../../../../eventStore/consumers/sqliteEventStoreConsumer';
import type { SQLiteProcessor } from '../../../../eventStore/consumers/sqliteProcessor';

void describe('SQLite event store consumer', () => {
  const dummyProcessor: SQLiteProcessor = {
    type: MessageProcessorType.REACTOR,
    id: uuid(),
    instanceId: uuid(),
    init: () => Promise.resolve(),
    start: () => Promise.resolve('BEGINNING'),
    close: () => Promise.resolve(),
    handle: () => Promise.resolve(),
    isActive: false,
    whenProcessed: () => Promise.resolve(),
  };

  let storage: DurableObjectStorage;
  let connection: CloudflareDurableObjectSQLiteConnection;
  let pool: CloudflareDurableObjectSQLiteConnectionPool;

  aroundEach(async (runTest) => {
    const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());

    await runInDurableObject(stub, async (_instance, state) => {
      storage = state.storage;
      connection = cloudflareDurableObjectSQLiteConnection({
        storage,
        serializer: JSONSerializer,
      });
      pool = cloudflareDurableObjectSQLitePool({
        connection,
      });
      await createEventStoreSchema({
        pool,
      });

      try {
        await runTest();
      } finally {
        await connection.close();
      }
    });
  });

  void it('creates not-started consumer for the specified connection string', () => {
    const consumer = sqliteEventStoreConsumer({
      driver: durableObjectEventStoreDriver,
      storage,
      processors: [dummyProcessor],
    });

    assertFalse(consumer.isRunning);
  });

  void describe('created consumer', () => {
    let consumer: SQLiteEventStoreConsumer;

    beforeEach(() => {
      consumer = sqliteEventStoreConsumer({
        driver: durableObjectEventStoreDriver,
        storage,
        processors: [dummyProcessor],
      });
    });

    afterEach(() => consumer.stop());

    void it('fails to start if there are no processors', async () => {
      const consumerToNotExistingServer = sqliteEventStoreConsumer({
        driver: durableObjectEventStoreDriver,
        storage,
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
    });

    void it('whenStarted resolves after successful start', async () => {
      const startedConsumer = sqliteEventStoreConsumer({
        driver: durableObjectEventStoreDriver,
        storage,
        processors: [dummyProcessor],
      });
      try {
        void startedConsumer.start();
        await startedConsumer.whenStarted();
        assertTrue(startedConsumer.isRunning);
      } finally {
        await startedConsumer.stop();
      }
    });

    void it('whenStarted rejects if there are no processors', async () => {
      const consumerWithoutProcessors = sqliteEventStoreConsumer({
        driver: durableObjectEventStoreDriver,
        storage,
        processors: [],
      });
      try {
        try {
          consumerWithoutProcessors.start().catch(() => {});
        } catch {
          // start() may throw synchronously on validation failure
        }
        await assertThrowsAsync<EmmettError>(
          () => consumerWithoutProcessors.whenStarted(),
          (error) =>
            error.message ===
            'Cannot start consumer without at least a single processor',
        );
      } finally {
        await consumerWithoutProcessors.stop();
      }
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
    let consumer: SQLiteEventStoreConsumer;

    beforeEach(async () => {
      consumer = sqliteEventStoreConsumer({
        driver: durableObjectEventStoreDriver,
        storage,
        processors: [dummyProcessor],
      });
      void consumer.start();
      await consumer.whenStarted();
    });
    afterEach(() => consumer.stop());

    void it('stops started consumer', async () => {
      await consumer.stop();

      assertFalse(consumer.isRunning);
    });
  });
});
