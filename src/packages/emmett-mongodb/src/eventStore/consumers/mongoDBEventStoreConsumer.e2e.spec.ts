import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertIsNotNull,
  assertIsNull,
  assertMatches,
  assertThatArray,
  assertThrowsAsync,
  type Message,
} from '@event-driven-io/emmett';
import {
  MongoDBContainer,
  type StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import { MongoClient, MongoNotConnectedError } from 'mongodb';
import { after, before, describe, it } from 'node:test';
import {
  mongoDBEventStoreConsumer,
  MongoDBEventStoreConsumer,
} from './mongoDBEventStoreConsumer';
import { getMongoDBEventStore, toStreamName } from '../mongoDBEventStore';
import { type ShoppingCartEvent } from '../../testing';
import { v4 as uuid } from 'uuid';
import type { MongoDBEventStoreProcessor } from './mongoDBEventStoreProcessor';

describe('MongoDBEventStoreConsumer', () => {
  let mongodb: StartedMongoDBContainer;
  let client: MongoClient;

  const dummyProcessor: MongoDBEventStoreProcessor = {
    id: uuid(),
    isActive: false,
    start: async () => 'BEGINNING',
    handle: async () => {},
  };

  before(async () => {
    mongodb = await new MongoDBContainer().start();
    client = new MongoClient(mongodb.getConnectionString(), {
      directConnection: true,
    });
  });

  after(async () => {
    try {
      await client.close();
      await mongodb.stop();
    } catch (error) {
      console.log(error);
    }
  });

  // TODO: actual test name
  void it('should create a non-started consumer for a specific client', () => {
    const consumer = mongoDBEventStoreConsumer({
      client,
      processors: [dummyProcessor],
    });

    assertFalse(consumer.isRunning);
  });
});
