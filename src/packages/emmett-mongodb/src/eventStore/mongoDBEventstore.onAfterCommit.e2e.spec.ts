import { assertEqual, type Event } from '@event-driven-io/emmett';
import { MongoClient } from 'mongodb';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  sharedMongoDBDatabase,
  type SharedMongoDBDatabase,
} from '../testing/sharedMongoDBDatabase';
import {
  getMongoDBEventStore,
  type MongoDBReadEvent,
} from './mongoDBEventStore';

type TestEvent = Event<'test', { counter: number }, { some: boolean }>;

void describe('MongoDBEventStore onAfterCommit', () => {
  let database: SharedMongoDBDatabase;
  let client: MongoClient;

  beforeAll(async () => {
    database = sharedMongoDBDatabase();
    client = new MongoClient(database.connectionString, {
      directConnection: true,
    });

    await client.connect();
  });

  afterAll(async () => {
    try {
      await client.close();
      await database.close();
    } catch (error) {
      console.log(error);
    }
  });

  void it('calls onAfterCommit hook after events append', async () => {
    // Given
    const appendedEvents: MongoDBReadEvent[] = [];
    const eventStore = getMongoDBEventStore({
      client,
      hooks: {
        onAfterCommit: (events) => {
          appendedEvents.push(...events);
        },
      },
    });
    const streamName = `test:${uuid()}`;

    const events: TestEvent[] = [
      {
        type: 'test',
        data: { counter: 1 },
        metadata: { some: true },
      },
      {
        type: 'test',
        data: { counter: 2 },
        metadata: { some: false },
      },
    ];

    // When
    await eventStore.appendToStream(streamName, events);

    // Then
    assertEqual(2, appendedEvents.length);
  });

  void it('calls onAfterCommit hook exactly once for each events append', async () => {
    // Given
    const appendedEvents: MongoDBReadEvent[] = [];
    const eventStore = getMongoDBEventStore({
      client,
      hooks: {
        onAfterCommit: (events) => {
          appendedEvents.push(...events);
        },
      },
    });
    const streamName = `test:${uuid()}`;

    const events: TestEvent[] = [
      {
        type: 'test',
        data: { counter: 1 },
        metadata: { some: true },
      },
      {
        type: 'test',
        data: { counter: 2 },
        metadata: { some: false },
      },
    ];
    const nextEvents: TestEvent[] = [
      {
        type: 'test',
        data: { counter: 3 },
        metadata: { some: true },
      },
      {
        type: 'test',
        data: { counter: 4 },
        metadata: { some: false },
      },
    ];

    // When
    await eventStore.appendToStream(streamName, events);
    await eventStore.appendToStream(streamName, nextEvents);

    // Then
    assertEqual(4, appendedEvents.length);
  });

  void it('silently fails when onAfterCommit hook failed but still keeps events', async () => {
    // Given
    const appendedEvents: MongoDBReadEvent[] = [];
    const eventStore = getMongoDBEventStore({
      client,
      hooks: {
        onAfterCommit: (events) => {
          appendedEvents.push(...events);
          throw new Error('onAfterCommit failed!');
        },
      },
    });

    const streamName = `test:${uuid()}`;

    const events: TestEvent[] = [
      {
        type: 'test',
        data: { counter: 1 },
        metadata: { some: true },
      },
      {
        type: 'test',
        data: { counter: 2 },
        metadata: { some: false },
      },
    ];

    // When
    await eventStore.appendToStream(streamName, events);

    // Then
    assertEqual(2, appendedEvents.length);
    const { events: eventsInStore } = await eventStore.readStream(streamName);
    assertEqual(2, eventsInStore.length);
  });
});
