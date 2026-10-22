import { JSONSerializer } from '@event-driven-io/dumbo';
import {
  InMemorySQLiteDatabase,
  sqlite3Connection,
  sqlite3Pool,
  type SQLite3Connection,
  type Sqlite3Pool,
} from '@event-driven-io/dumbo/sqlite3';
import { assertDeepEqual, type Event } from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createEventStoreSchema } from '../../../../eventStore/schema';
import { appendToStream } from '../../../../eventStore/schema/appendToStream';
import { readMessagesBatch } from '../../../../eventStore/schema/readMessagesBatch';

export type TestEvent = Event<
  'TestEvent',
  { meta: string },
  { meta: string; schemaVersion?: string }
>;

void describe('reading messages in batches', () => {
  let connection: SQLite3Connection;
  let pool: Sqlite3Pool;
  const serializer = JSONSerializer;

  beforeAll(async () => {
    connection = sqlite3Connection({
      fileName: InMemorySQLiteDatabase,
      serializer,
    });
    pool = sqlite3Pool({
      fileName: InMemorySQLiteDatabase,
      singleton: true,
      connection,
    });
    await createEventStoreSchema({
      pool,
    });
  });

  afterAll(async () => {
    await connection.close();
  });

  void it('reads the schema version from message metadata', async () => {
    const streamId = uuid();
    await appendToStream<TestEvent>(connection, streamId, 'test', [
      {
        type: 'TestEvent',
        data: { meta: 'evt1' },
        metadata: { meta: 'evt1', schemaVersion: '2' },
      },
    ]);

    const poll = await readMessagesBatch<TestEvent>(connection.execute, {
      after: 0n,
      batchSize: 100,
      serializer,
    });

    assertDeepEqual(
      poll.messages
        .filter((m) => m.metadata.streamName === streamId)
        .map((m) => m.metadata.schemaVersion),
      ['2'],
    );
  });

  void it('reads schema version 1 when message metadata has no schema version', async () => {
    const streamId = uuid();
    await appendToStream<TestEvent>(connection, streamId, 'test', [
      {
        type: 'TestEvent',
        data: { meta: 'evt1' },
        metadata: { meta: 'evt1' },
      },
    ]);

    const poll = await readMessagesBatch<TestEvent>(connection.execute, {
      after: 0n,
      batchSize: 100,
      serializer,
    });

    assertDeepEqual(
      poll.messages
        .filter((m) => m.metadata.streamName === streamId)
        .map((m) => m.metadata.schemaVersion),
      ['1'],
    );
  });
});
