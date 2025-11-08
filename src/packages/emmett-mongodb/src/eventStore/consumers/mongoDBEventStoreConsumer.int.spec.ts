import {
  assertFails,
  assertFalse,
  assertThrowsAsync,
  assertTrue,
  EmmettError,
  type MessageProcessor,
} from '@event-driven-io/emmett';
import {
  MongoDBContainer,
  type StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  mongoDBEventStoreConsumer,
  type MongoDBEventStoreConsumer,
} from './mongoDBEventsConsumer';

void describe('mongoDB event store consumer', () => {
  let mongoDB: StartedMongoDBContainer;
  let connectionString: string;
  const dummyProcessor: MessageProcessor = {
    type: 'reactor',
    id: uuid(),
    start: () => Promise.resolve('BEGINNING'),
    close: () => Promise.resolve(),
    handle: () => Promise.resolve(),
    isActive: false,
  };

  before(async () => {
    mongoDB = await new MongoDBContainer('mongo:6.0.1').start();
    connectionString = mongoDB.getConnectionString();
  });

  after(async () => {
    try {
      await mongoDB.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('creates not-started consumer for the specified connection string', () => {
    const consumer = mongoDBEventStoreConsumer({
      connectionString,
      clientOptions: { directConnection: true },
      processors: [dummyProcessor],
    });

    assertFalse(consumer.isRunning);
  });

  void it('creates not-started consumer if connection string targets not existing mongoDB database', () => {
    const connectionStringToNotExistingDB = 'mongodb://not-existing:32792';
    const consumer = mongoDBEventStoreConsumer({
      connectionString: connectionStringToNotExistingDB,
      clientOptions: { directConnection: true },
      processors: [dummyProcessor],
    });

    assertFalse(consumer.isRunning);
  });

  void describe('created consumer', () => {
    let consumer: MongoDBEventStoreConsumer;

    beforeEach(() => {
      consumer = mongoDBEventStoreConsumer({
        connectionString,
        clientOptions: { directConnection: true },
        processors: [dummyProcessor],
      });
    });
    afterEach(() => {
      return consumer.close();
    });

    void it('subscribes to existing event store', () => {
      consumer.start().catch(() => assertFails());

      assertTrue(consumer.isRunning);
    });

    // void it('fails to start if connection string targets not existing mongoDB database', async () => {
    //   const connectionStringToNotExistingDB = 'mongodb://not-existing:2113';
    //   const consumerToNotExistingServer = mongoDBEventStoreConsumer({
    //     connectionString: connectionStringToNotExistingDB,
    //     processors: [dummyProcessor],
    //   });
    //   await assertThrowsAsync(
    //     () => consumerToNotExistingServer.start(),
    //     (error) => {
    //       return 'type' in error && error.type === 'unavailable';
    //     },
    //   );
    // });

    void it('fails to start if there are no processors', async () => {
      const consumerToNotExistingServer = mongoDBEventStoreConsumer({
        connectionString,
        clientOptions: { directConnection: true },
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
    let consumer: MongoDBEventStoreConsumer;

    beforeEach(() => {
      consumer = mongoDBEventStoreConsumer({
        connectionString,
        clientOptions: { directConnection: true },
        processors: [dummyProcessor],
      });
    });
    afterEach(() => consumer.close());

    void it('stops started consumer', async () => {
      await consumer.stop();

      assertFalse(consumer.isRunning);
    });
  });
});
