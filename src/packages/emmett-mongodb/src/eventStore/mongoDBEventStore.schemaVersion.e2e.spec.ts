import {
  assertOk,
  event,
  reactor,
  type Event,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import { MongoClient, type Collection } from 'mongodb';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PricedProductItem } from '../testing';
import {
  sharedMongoDBDatabase,
  type SharedMongoDBDatabase,
} from '../testing/sharedMongoDBDatabase';
import {
  getMongoDBEventStore,
  toStreamCollectionName,
  toStreamName,
  type EventStream,
  type MongoDBEventStore,
} from './';

type ProductItemAddedV2 = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem; currency: string },
  undefined,
  2
>;

void describe('MongoDBEventStore schema version', () => {
  let database: SharedMongoDBDatabase;
  let eventStore: MongoDBEventStore;
  let client: MongoClient;
  let collection: Collection<EventStream>;

  const streamType = 'shopping_cart';
  const productItem: PricedProductItem = {
    productId: '123',
    quantity: 10,
    price: 3,
  };

  beforeAll(async () => {
    database = sharedMongoDBDatabase();
    client = new MongoClient(database.connectionString, {
      directConnection: true,
    });

    await client.connect();
    collection = client
      .db()
      .collection<EventStream>(toStreamCollectionName(streamType));

    eventStore = getMongoDBEventStore({ client });
  });

  afterAll(async () => {
    try {
      await client.close();
      await database.close();
    } catch (error) {
      console.log(error);
    }
  });

  const insertLegacyStream = async (
    streamName: string,
    streamId: string,
    legacyMetadata: Record<string, unknown>,
  ) => {
    const now = new Date();
    await collection.insertOne({
      streamName,
      messages: [
        {
          type: 'ProductItemAdded',
          data: { productItem },
          metadata: {
            messageId: 'legacy-message-1',
            streamName,
            streamPosition: 1n,
            ...legacyMetadata,
          },
        } as unknown as EventStream['messages'][number],
      ],
      metadata: {
        streamId,
        streamType,
        streamPosition: 1n,
        createdAt: now,
        updatedAt: now,
      },
      projections: {},
    });
  };

  const consumeLegacyStream = async (
    streamName: string,
    insert: () => Promise<void>,
  ): Promise<RecordedMessage<Event>[]> => {
    const consumer = eventStore.consumer<Event>();
    const received: RecordedMessage<Event>[] = [];

    consumer.reactor(
      reactor<Event>({
        processorId: uuid(),
        checkpoints: 'DISABLED',
        eachMessage: (message) => {
          if (message.metadata.streamName === streamName)
            received.push(message);
        },
      }),
    );

    const consumerPromise = consumer.start();
    try {
      await consumer.whenStarted();
      await insert();
      await consumer.whenCaughtUp();
    } finally {
      await consumer.close();
      await consumerPromise;
    }

    return received;
  };

  const legacyCases = [
    {
      name: 'reads the version from the metadata of a message stored without a version',
      legacyMetadata: { schemaVersion: '2', tenantId: 'acme' },
      schemaVersion: 2,
    },
    {
      name: 'reads version 1 for a message stored without any version',
      legacyMetadata: { tenantId: 'acme' },
      schemaVersion: 1,
    },
    {
      name: 'reads version 1 for a message stored with a non-numeric metadata version',
      legacyMetadata: { schemaVersion: 'v2', tenantId: 'acme' },
      schemaVersion: 1,
    },
  ];

  void it('stores the schema version outside the message metadata', async () => {
    const streamId = uuid();
    const streamName = toStreamName(streamType, streamId);

    await eventStore.appendToStream(streamName, [
      event<ProductItemAddedV2>(
        'ProductItemAdded',
        { productItem, currency: 'USD' },
        2,
      ),
    ]);

    const stream = await collection.findOne(
      { streamName },
      { useBigInt64: true },
    );
    assertOk(stream);
    expect(stream.messages).toEqual([
      {
        type: 'ProductItemAdded',
        data: { productItem, currency: 'USD' },
        kind: 'Event',
        schemaVersion: 2,
        metadata: {
          messageId: expect.any(String) as unknown,
          streamName,
          streamPosition: 1n,
          correlationId: expect.any(String) as unknown,
          causationId: expect.any(String) as unknown,
          traceId: expect.any(String) as unknown,
          spanId: expect.any(String) as unknown,
        },
      },
    ]);
    expect(stream.messages[0]!.metadata).not.toHaveProperty('schemaVersion');
  });

  void it('reads kind Event for a message stored without a kind', async () => {
    const streamId = uuid();
    const streamName = toStreamName(streamType, streamId);
    await insertLegacyStream(streamName, streamId, { tenantId: 'acme' });

    const { events } = await eventStore.readStream(streamName);

    expect(events.map((message) => message.kind)).toEqual(['Event']);
  });

  void describe.each(legacyCases)(
    '$name',
    ({ legacyMetadata, schemaVersion }) => {
      void it('through readStream', async () => {
        const streamId = uuid();
        const streamName = toStreamName(streamType, streamId);
        await insertLegacyStream(streamName, streamId, legacyMetadata);

        const { events } = await eventStore.readStream(streamName);

        expect(events).toEqual([
          {
            type: 'ProductItemAdded',
            data: { productItem },
            kind: 'Event',
            schemaVersion,
            metadata: {
              messageId: 'legacy-message-1',
              streamName,
              streamPosition: 1n,
              tenantId: 'acme',
            },
          },
        ]);
        expect(events[0]!.metadata).not.toHaveProperty('schemaVersion');
      });

      void it('through a consumer', async () => {
        const streamId = uuid();
        const streamName = toStreamName(streamType, streamId);

        const received = await consumeLegacyStream(streamName, () =>
          insertLegacyStream(streamName, streamId, legacyMetadata),
        );

        expect(received).toEqual([
          {
            type: 'ProductItemAdded',
            data: { productItem },
            kind: 'Event',
            schemaVersion,
            metadata: {
              messageId: 'legacy-message-1',
              streamName,
              streamPosition: 1n,
              tenantId: 'acme',
              checkpoint: expect.any(String) as unknown,
              globalPosition: expect.any(String) as unknown,
            },
          },
        ]);
        expect(received[0]!.metadata).not.toHaveProperty('schemaVersion');
      });
    },
  );
});
