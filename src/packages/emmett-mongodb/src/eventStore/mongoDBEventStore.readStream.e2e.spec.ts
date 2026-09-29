import { assertDeepEqual, assertFalse } from '@event-driven-io/emmett';
import { MongoClient } from 'mongodb';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  sharedMongoDBDatabase,
  type SharedMongoDBDatabase,
} from '../testing/sharedMongoDBDatabase';
import { getMongoDBEventStore, toStreamName, type MongoDBEventStore } from './';

void describe('MongoDBEventStore readStream ranges', () => {
  let database: SharedMongoDBDatabase;
  let client: MongoClient;
  let eventStore: MongoDBEventStore;
  const streamName = toStreamName('shopping_cart', uuid());

  beforeAll(async () => {
    database = sharedMongoDBDatabase();
    client = new MongoClient(database.connectionString, {
      directConnection: true,
    });
    await client.connect();
    eventStore = getMongoDBEventStore({ client });

    await eventStore.appendToStream(
      streamName,
      Array.from({ length: 10 }, (_, index) => ({
        type: 'ProductItemAdded',
        data: { index },
      })),
    );
  });

  afterAll(async () => {
    await client.close();
    await database.close();
  });

  const read = async (range: {
    from?: bigint;
    to?: bigint;
    maxCount?: bigint;
  }) => {
    const result = await eventStore.readStream(streamName, range);

    return {
      positions: result.events.map((e) => e.metadata.streamPosition),
      currentStreamVersion: result.currentStreamVersion,
      streamExists: result.streamExists,
    };
  };

  const positions = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => BigInt(from + i));

  void it('reads from an inclusive position', async () => {
    assertDeepEqual((await read({ from: 4n })).positions, positions(4, 10));
  });

  void it('reads up to an inclusive position', async () => {
    assertDeepEqual((await read({ to: 6n })).positions, positions(1, 6));
  });

  void it('applies maxCount within an inclusive range', async () => {
    assertDeepEqual(
      (await read({ from: 3n, to: 9n, maxCount: 3n })).positions,
      positions(3, 5),
    );
    assertDeepEqual(
      (await read({ from: 3n, maxCount: 2n })).positions,
      positions(3, 4),
    );
  });

  void it('reports the stream version and existence for any range', async () => {
    assertDeepEqual(await read({ from: 20n }), {
      positions: [],
      currentStreamVersion: 10n,
      streamExists: true,
    });
  });

  void it('reports a missing stream', async () => {
    const result = await eventStore.readStream(
      toStreamName('shopping_cart', uuid()),
      { from: 2n },
    );

    assertFalse(result.streamExists);
  });
});
