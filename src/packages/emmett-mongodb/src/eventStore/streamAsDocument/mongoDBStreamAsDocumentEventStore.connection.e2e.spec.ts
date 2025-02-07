import { assertIsNotNull, assertThrowsAsync } from '@event-driven-io/emmett';
import {
  MongoDBContainer,
  type StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import { MongoClient, MongoNotConnectedError } from 'mongodb';
import { after, before, describe, it } from 'node:test';
import { getMongoDBEventStore, toStreamCollectionName } from '.';
import { assertCanAppend, ShoppingCartStreamType } from '../testing';

void describe('MongoDBEventStore connection', () => {
  let mongodb: StartedMongoDBContainer;

  before(async () => {
    mongodb = await new MongoDBContainer().start();
  });

  after(async () => {
    try {
      await mongodb.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('connects using connection string', async () => {
    const eventStore = getMongoDBEventStore({
      connectionString: mongodb.getConnectionString(),
      clientOptions: { directConnection: true },
    });
    try {
      await assertCanAppend(eventStore);
    } finally {
      await eventStore.close();
    }
  });

  void it('disconnects on close', async () => {
    // given
    const eventStore = getMongoDBEventStore({
      connectionString: mongodb.getConnectionString(),
      clientOptions: { directConnection: true },
    });
    // and
    await assertCanAppend(eventStore);

    // when
    await eventStore.close();

    // then
    await assertThrowsAsync(
      () => assertCanAppend(eventStore),
      (error) => error instanceof MongoNotConnectedError,
    );
  });

  void it('connects using not-connected client', async () => {
    const client = new MongoClient(mongodb.getConnectionString(), {
      directConnection: true,
    });
    try {
      const eventStore = getMongoDBEventStore({
        client,
      });

      await assertCanAppend(eventStore);

      // this should succeed as event store should call connect internally
      const stream = await client
        .db()
        .collection(toStreamCollectionName(ShoppingCartStreamType))
        .findOne();
      assertIsNotNull(stream);
    } finally {
      await client.close();
    }
  });

  void it('connects using connected client', async () => {
    const client = new MongoClient(mongodb.getConnectionString(), {
      directConnection: true,
    });

    await client.connect();
    try {
      const eventStore = getMongoDBEventStore({
        client,
      });

      await assertCanAppend(eventStore);
    } finally {
      await client.close();
    }
  });
});
