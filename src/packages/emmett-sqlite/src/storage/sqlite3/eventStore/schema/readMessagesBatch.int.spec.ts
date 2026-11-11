import { JSONSerializer, SQL } from '@event-driven-io/dumbo';
import {
  InMemorySQLiteDatabase,
  sqlite3Connection,
  sqlite3Pool,
  type SQLite3Connection,
  type Sqlite3Pool,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertDeepEqual,
  bigIntProcessorCheckpoint,
  type Command,
  type Event,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createEventStoreSchema } from '../../../../eventStore/schema';
import { appendToStream } from '../../../../eventStore/schema/appendToStream';
import { defaultTag } from '../../../../eventStore/schema/typing';
import { readMessagesBatch } from '../../../../eventStore/schema/readMessagesBatch';

export type TestEvent = Event<'TestEvent', { meta: string }, { meta: string }>;

export type TestEventV2 = Event<
  'TestEvent',
  { meta: string },
  { meta: string },
  2
>;

export type TestCommandV3 = Command<
  'TestCommand',
  { meta: string },
  undefined,
  3
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

  void it('reads the schema version from the column', async () => {
    const streamId = uuid();
    await appendToStream<TestEventV2>(connection, streamId, 'test', [
      {
        type: 'TestEvent',
        data: { meta: 'evt1' },
        metadata: { meta: 'evt1' },
        schemaVersion: 2,
      },
    ]);

    const poll = await readMessagesBatch<TestEventV2>(connection.execute, {
      after: 0n,
      batchSize: 100,
      serializer,
    });

    assertDeepEqual(
      poll.messages
        .filter((m) => m.metadata.streamName === streamId)
        .map((m) => m.schemaVersion),
      [2],
    );
  });

  void it('reads a stored command with the Command kind', async () => {
    const streamId = uuid();
    const messageId = uuid();
    await connection.execute.command(
      SQL`INSERT INTO emt_messages
        (stream_id, stream_position, partition, message_kind, message_data, message_metadata, message_schema_version, message_type, message_id)
        VALUES (${streamId}, 1, ${defaultTag}, 'C', '{"meta":"cmd1"}', '{}', 3, 'TestCommand', ${messageId})`,
    );

    const poll = await readMessagesBatch<TestCommandV3>(connection.execute, {
      after: 0n,
      batchSize: 100,
      serializer,
    });

    const [message] = poll.messages.filter(
      (m) => m.metadata.streamName === streamId,
    );
    const globalPosition = bigIntProcessorCheckpoint(
      BigInt(message!.metadata.globalPosition),
    );
    assertDeepEqual<unknown[]>(
      poll.messages.filter((m) => m.metadata.streamName === streamId),
      [
        {
          type: 'TestCommand',
          kind: 'Command',
          data: { meta: 'cmd1' },
          schemaVersion: 3,
          metadata: {
            messageId,
            streamName: streamId,
            streamPosition: 1n,
            globalPosition,
            checkpoint: globalPosition,
          },
        },
      ],
    );
  });

  void it('reads schema version 1 when the message was appended without a schema version', async () => {
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
        .map((m) => m.schemaVersion),
      [1],
    );
  });
});
