import type { D1Database } from '@cloudflare/workers-types';
import {
  d1Connection,
  d1Pool,
  type D1Connection,
  type D1ConnectionPool,
} from '@event-driven-io/dumbo/cloudflare';
import type { EmmettError } from '@event-driven-io/emmett';
import {
  assertFalse,
  assertThrowsAsync,
  assertTrue,
  JSONSerializer,
  MessageProcessorType,
} from '@event-driven-io/emmett';
import { Miniflare } from 'miniflare';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { d1EventStoreDriver } from '../..';
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

  let mf: Miniflare;
  let database: D1Database;
  let connection: D1Connection;
  let pool: D1ConnectionPool;

  beforeEach(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      d1Databases: { DB: 'test-db-id' },
    });
    database = await mf.getD1Database('DB');
    connection = d1Connection({
      database,
      serializer: JSONSerializer,
      transactionOptions: {
        allowNestedTransactions: true,
        mode: 'session_based',
      },
    });
    pool = d1Pool({
      database,
      connection,
    });
    await createEventStoreSchema({
      pool,
    });
  });

  afterEach(async () => {
    await connection.close();
    await mf.dispose();
  });

  void it('creates not-started consumer for the specified connection string', () => {
    const consumer = sqliteEventStoreConsumer({
      driver: d1EventStoreDriver,
      database,
      processors: [dummyProcessor],
    });

    assertFalse(consumer.isRunning);
  });

  void describe('created consumer', () => {
    let consumer: SQLiteEventStoreConsumer;

    beforeEach(() => {
      consumer = sqliteEventStoreConsumer({
        driver: d1EventStoreDriver,
        database,
        processors: [dummyProcessor],
        connectionOptions: { connection },
      });
    });

    afterEach(() => consumer.stop());

    void it('fails to start if there are no processors', async () => {
      const consumerToNotExistingServer = sqliteEventStoreConsumer({
        driver: d1EventStoreDriver,
        database,
        processors: [],
        connectionOptions: { connection },
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
        driver: d1EventStoreDriver,
        database,
        processors: [dummyProcessor],
        connectionOptions: { connection },
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
        driver: d1EventStoreDriver,
        database,
        processors: [],
        connectionOptions: { connection },
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
        driver: d1EventStoreDriver,
        database,
        processors: [dummyProcessor],
        connectionOptions: { connection },
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
