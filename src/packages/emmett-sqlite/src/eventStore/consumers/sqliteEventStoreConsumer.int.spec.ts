import { InMemorySQLiteDatabase } from '@event-driven-io/dumbo/sqlite3';
import {
  assertFalse,
  assertThrowsAsync,
  EmmettError,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { sqlite3EventStoreDriver } from '../../sqlite3';
import {
  sqliteEventStoreConsumer,
  type SQLiteEventStoreConsumer,
} from './sqliteEventStoreConsumer';
import type { SQLiteProcessor } from './sqliteProcessor';

void describe('SQLite event store consumer', () => {
  const dummyProcessor: SQLiteProcessor = {
    id: uuid(),
    start: () => Promise.resolve('BEGINNING'),
    handle: () => Promise.resolve(),
    isActive: false,
  };

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
      });
    });
    afterEach(() => consumer.stop());

    void it('fails to start if there are no processors', async () => {
      const consumerToNotExistingServer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName: InMemorySQLiteDatabase,
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

    beforeEach(() => {
      consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName: InMemorySQLiteDatabase,
        processors: [dummyProcessor],
      });
    });
    afterEach(() => consumer.stop());

    void it('stops started consumer', async () => {
      await consumer.stop();

      assertFalse(consumer.isRunning);
    });
  });
});
