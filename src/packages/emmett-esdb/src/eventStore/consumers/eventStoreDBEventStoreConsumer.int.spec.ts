import {
  assertFails,
  assertFalse,
  assertThrowsAsync,
  assertTrue,
  EmmettError,
} from '@event-driven-io/emmett';
import {
  EventStoreDBContainer,
  StartedEventStoreDBContainer,
} from '@event-driven-io/emmett-testcontainers';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  eventStoreDBEventStoreConsumer,
  type EventStoreDBEventStoreConsumer,
} from './eventStoreDBEventStoreConsumer';
import type { EventStoreDBEventStoreProcessor } from './eventStoreDBEventStoreProcessor';

void describe('EventStoreDB event store consumer', () => {
  let eventStoreDB: StartedEventStoreDBContainer;
  let connectionString: string;
  const dummyProcessor: EventStoreDBEventStoreProcessor = {
    id: uuid(),
    start: () => Promise.resolve('BEGINNING'),
    handle: () => Promise.resolve(),
    isActive: false,
  };

  before(async () => {
    eventStoreDB = await new EventStoreDBContainer().start();
    connectionString = eventStoreDB.getConnectionString();
  });

  after(async () => {
    try {
      await eventStoreDB.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('creates not-started consumer for the specified connection string', () => {
    const consumer = eventStoreDBEventStoreConsumer({
      connectionString,
      processors: [dummyProcessor],
    });

    assertFalse(consumer.isRunning);
  });

  void it('creates not-started consumer if connection string targets not existing EventStoreDB database', () => {
    const connectionStringToNotExistingDB =
      'esdb://not-existing:2113?tls=false';
    const consumer = eventStoreDBEventStoreConsumer({
      connectionString: connectionStringToNotExistingDB,
      processors: [dummyProcessor],
    });

    assertFalse(consumer.isRunning);
  });

  void describe('created consumer', () => {
    let consumer: EventStoreDBEventStoreConsumer;

    beforeEach(() => {
      consumer = eventStoreDBEventStoreConsumer({
        connectionString,
        processors: [dummyProcessor],
      });
    });
    afterEach(() => {
      return consumer.stop();
    });

    void it('subscribes to existing event store', () => {
      consumer.start().catch(() => assertFails());

      assertTrue(consumer.isRunning);
    });

    void it('fails to start if connection string targets not existing EventStoreDB database', async () => {
      const connectionStringToNotExistingDB =
        'esdb://not-existing:2113?tls=false';
      const consumerToNotExistingServer = eventStoreDBEventStoreConsumer({
        connectionString: connectionStringToNotExistingDB,
        processors: [dummyProcessor],
      });
      await assertThrowsAsync(
        () => consumerToNotExistingServer.start(),
        (error) => {
          return 'type' in error && error.type === 'unavailable';
        },
      );
    });

    void it('fails to start if there are no processors', async () => {
      const consumerToNotExistingServer = eventStoreDBEventStoreConsumer({
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
    let consumer: EventStoreDBEventStoreConsumer;

    beforeEach(() => {
      consumer = eventStoreDBEventStoreConsumer({
        connectionString,
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
