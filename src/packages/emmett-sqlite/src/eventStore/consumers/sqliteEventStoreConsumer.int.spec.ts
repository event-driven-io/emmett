import {
  InMemorySQLiteDatabase,
  sqlite3Connection,
  type SQLite3Connection,
} from '@event-driven-io/dumbo/sqlite3';
import type { EmmettError } from '@event-driven-io/emmett';
import {
  assertFalse,
  assertThrowsAsync,
  assertTrue,
  JSONSerializer,
  MessageProcessorType,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { sqlite3EventStoreDriver } from '../../sqlite3';
import { createEventStoreSchema } from '../schema';
import {
  sqliteEventStoreConsumer,
  type SQLiteEventStoreConsumer,
} from './sqliteEventStoreConsumer';
import type { SQLiteProcessor } from './sqliteProcessor';

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

  let connection: SQLite3Connection;

  beforeEach(async () => {
    connection = sqlite3Connection({
      fileName: InMemorySQLiteDatabase,
      serializer: JSONSerializer,
    });
    await createEventStoreSchema(connection);
  });

  afterEach(() => connection.close());

  void it('creates not-started consumer for the specified connection string', () => {
    const consumer = sqliteEventStoreConsumer({
      driver: sqlite3EventStoreDriver,
      fileName: InMemorySQLiteDatabase,
      processors: [dummyProcessor],
    });

    assertFalse(consumer.isRunning);
  });

  void describe('created consumer', () => {
    let consumer: SQLiteEventStoreConsumer;

    beforeEach(() => {
      consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName: InMemorySQLiteDatabase,
        processors: [dummyProcessor],
        connectionOptions: { connection },
      });
    });

    afterEach(() => consumer.stop());

    void it('fails to start if there are no processors', async () => {
      const consumerToNotExistingServer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName: InMemorySQLiteDatabase,
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
        driver: sqlite3EventStoreDriver,
        fileName: InMemorySQLiteDatabase,
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
        driver: sqlite3EventStoreDriver,
        fileName: InMemorySQLiteDatabase,
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
        driver: sqlite3EventStoreDriver,
        fileName: InMemorySQLiteDatabase,
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
